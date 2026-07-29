// api/content — accept, decline, and move content items through the pipeline.
//
// WO-005. Form-POST from the Organic tab. Every path redirects back to the tab
// so the browser's back button and a refresh both behave, and there is never
// unsaved state sitting in a component.
import { getProfile, isAgency } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUSES = ["idea", "queued", "drafting", "in_qc", "awaiting_client", "published", "declined"];

export async function POST(req: Request) {
  const profile = await getProfile();
  if (!isAgency(profile)) {
    return Response.json({ error: "Agency access required" }, { status: 403 });
  }

  const form = await req.formData();
  const str = (k: string) => (form.get(k) as string | null)?.trim() || null;

  const action = str("action");
  const clientId = str("client_id");
  if (!clientId) return Response.json({ error: "client_id required" }, { status: 400 });

  const db = dbClient();
  const back = (msg?: string) =>
    Response.redirect(
      `${new URL(req.url).origin}/dashboard/${clientId}/organic${msg ? `?msg=${encodeURIComponent(msg)}` : ""}`,
      303
    );

  // ── accept: an idea becomes queued work ───────────────────────────────────
  if (action === "accept") {
    const title = str("title");
    if (!title) return Response.json({ error: "title required" }, { status: 400 });

    const expected = str("expected_clicks_mo");

    const { error } = await db.from("content_items").insert({
      client_id: clientId,
      title,
      target_query: str("target_query"),
      rationale: str("rationale"),
      confidence: str("confidence"),
      // The estimate is stored as it was at acceptance time. Recording the
      // prediction before the outcome is the only way the verdict later means
      // anything.
      expected_clicks_mo: expected ? Number(expected) : null,
      status: "queued",
      status_note: `Accepted by ${profile?.full_name ?? profile?.email ?? "agency"}`,
      source: "agent",
    });

    // 23505 is unique_violation — the partial index that stops the same topic
    // being queued twice. Not an error worth showing as a failure: the desired
    // state already holds.
    if (error && error.code !== "23505") {
      return Response.json({ error: error.message }, { status: 500 });
    }
    return back(error?.code === "23505" ? "Already in the pipeline" : "Added to the pipeline");
  }

  // ── decline: recorded with a reason, and muted ────────────────────────────
  if (action === "decline") {
    const reason = str("reason");
    // Enforced server-side too. `required` on the input is a convenience, not a
    // guarantee — anything can POST here.
    if (!reason) return Response.json({ error: "A reason is required to decline" }, { status: 400 });

    const { error } = await db.from("content_items").insert({
      client_id: clientId,
      title: str("title") ?? str("target_query") ?? "Declined idea",
      target_query: str("target_query"),
      status: "declined",
      declined_at: new Date().toISOString(),
      decline_reason: reason,
      status_note: `Declined by ${profile?.full_name ?? profile?.email ?? "agency"}`,
      source: "agent",
    });

    if (error && error.code !== "23505") {
      return Response.json({ error: error.message }, { status: 500 });
    }
    return back("Declined and muted for 60 days");
  }

  // ── status: move an existing item along ───────────────────────────────────
  if (action === "status") {
    const id = str("id");
    const status = str("status");
    if (!id || !status) return Response.json({ error: "id and status required" }, { status: 400 });
    if (!STATUSES.includes(status)) return Response.json({ error: "unknown status" }, { status: 400 });

    const patch: Record<string, unknown> = {
      status,
      status_note: str("status_note"),
      updated_at: new Date().toISOString(),
    };
    if (status === "published") {
      patch.published_at = new Date().toISOString();
      patch.url = str("url");
    }

    const { error } = await db.from("content_items").update(patch).eq("id", id).eq("client_id", clientId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return back("Updated");
  }

  return Response.json({ error: `unknown action: ${action}` }, { status: 400 });
}
