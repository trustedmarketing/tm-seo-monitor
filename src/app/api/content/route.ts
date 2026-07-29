// api/content — accept, decline, and move content items through the pipeline.
//
// WO-005. Form-POST from the Organic tab. Every path redirects back to the tab
// so the browser's back button and a refresh both behave, and there is never
// unsaved state sitting in a component.
import { getProfile, isAgency } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { draftBrief, clusterFor } from "@/lib/contentBrief";
import { draftArticle } from "@/lib/contentDraft";
import { normalisePath } from "@/lib/linkPolicy";
import { readWindows } from "@/lib/organicCollector";
import { BudgetExceededError } from "@/lib/ai";

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
  const origin = new URL(req.url).origin;
  const back = (msg?: string) =>
    Response.redirect(
      `${origin}/dashboard/${clientId}/organic${msg ? `?msg=${encodeURIComponent(msg)}` : ""}`,
      303
    );
  const backToItem = (id: string, msg?: string) =>
    Response.redirect(
      `${origin}/dashboard/${clientId}/content/${id}${msg ? `?msg=${encodeURIComponent(msg)}` : ""}`,
      303
    );

  // ── accept: an idea becomes queued work ───────────────────────────────────
  if (action === "accept") {
    const title = str("title");
    if (!title) return Response.json({ error: "title required" }, { status: 400 });

    const expected = str("expected_clicks_mo");

    const { data: inserted, error } = await db.from("content_items").insert({
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
    }).select("id").maybeSingle();

    // 23505 is unique_violation — the partial index that stops the same topic
    // being queued twice. Not an error worth showing as a failure: the desired
    // state already holds.
    if (error && error.code !== "23505") {
      return Response.json({ error: error.message }, { status: 500 });
    }
    if (error?.code === "23505") return back("Already in the pipeline");

    // Land on the item, not back on the list. "Added to the pipeline" with no
    // onward route was the dead end this whole change exists to remove.
    return inserted?.id ? backToItem(inserted.id, "Added to the pipeline") : back("Added to the pipeline");
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
    return backToItem(id, status === "published" ? "Published — measurement starts now" : "Moved");
  }

  // ── brief: generate what a writer works from ──────────────────────────────
  if (action === "brief") {
    const id = str("id");
    if (!id) return Response.json({ error: "id required" }, { status: 400 });

    const { data: item, error: itemErr } = await db
      .from("content_items").select("*").eq("id", id).eq("client_id", clientId).maybeSingle();
    if (itemErr) return Response.json({ error: itemErr.message }, { status: 500 });
    if (!item) return Response.json({ error: "not found" }, { status: 404 });

    const { data: client } = await db.from("clients").select("name").eq("id", clientId).single();

    // The cluster is what makes this different from asking a model for an
    // outline: real searches this site already appears for.
    const windows = await readWindows(db, clientId);
    const target = item.target_query ?? item.title;
    const cluster = clusterFor(target, windows.current, item.url ?? null);

    try {
      const { brief, costUsd } = await draftBrief(db, {
        clientId,
        clientName: client?.name ?? "the client",
        title: item.title,
        targetQuery: item.target_query,
        // A rework when we know which page; a new article otherwise.
        action: item.url ? "improve_page" : "new_article",
        page: item.url,
        rationale: item.rationale,
        cluster,
      });

      const { error: saveErr } = await db.from("content_items").update({
        brief,
        brief_generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", id).eq("client_id", clientId);

      // Checked: a brief generated, paid for, and then silently not saved is the
      // worst outcome here — it costs money and looks like the button did nothing.
      if (saveErr) return Response.json({ error: `brief generated but not saved: ${saveErr.message}` }, { status: 500 });

      return backToItem(id, `Brief written · $${costUsd.toFixed(3)}`);
    } catch (e) {
      // The ceiling is a control, not a crash. Say what happened and what to do.
      if (e instanceof BudgetExceededError) return backToItem(id, e.message);
      return backToItem(id, `Brief failed: ${(e as Error).message}`);
    }
  }

  // ── draft: write the whole article ────────────────────────────────────────
  if (action === "draft") {
    const id = str("id");
    if (!id) return Response.json({ error: "id required" }, { status: 400 });

    const { data: item, error: itemErr } = await db
      .from("content_items").select("*").eq("id", id).eq("client_id", clientId).maybeSingle();
    if (itemErr) return Response.json({ error: itemErr.message }, { status: 500 });
    if (!item) return Response.json({ error: "not found" }, { status: 404 });

    // The brief is the spec. Drafting without one produces a generic article,
    // which is exactly the output this whole pipeline exists to avoid.
    if (!item.brief) return backToItem(id, "Write the brief first — the draft is written to it.");

    const { data: client } = await db
      .from("clients").select("name, domain, competitor_domains").eq("id", clientId).single();
    if (!client) return Response.json({ error: "client not found" }, { status: 404 });

    const windows = await readWindows(db, clientId);
    const target = item.target_query ?? item.title;
    const cluster = clusterFor(target, windows.current, item.url ?? null);

    // Pages we KNOW exist, because Search Console recorded impressions for
    // them. This is the whole defence against invented internal links: it is
    // evidence the URL is served and indexed, not an assumption.
    const knownPages = [...new Set(
      windows.current
        .filter((r) => r.page)
        .map((r) => normalisePath(r.page as string))
    )];

    try {
      const { draft, costUsd } = await draftArticle(db, {
        clientId,
        clientName: client.name,
        domain: String(client.domain).replace(/^https?:\/\//, "").replace(/\/$/, ""),
        brief: item.brief,
        targetQuery: item.target_query,
        cluster,
        knownPages,
        competitors: (client.competitor_domains ?? []) as string[],
      });

      const { error: saveErr } = await db.from("content_items").update({
        draft,
        draft_generated_at: new Date().toISOString(),
        // Drafting is where this now is, whatever it said before.
        status: item.status === "queued" ? "drafting" : item.status,
        updated_at: new Date().toISOString(),
      }).eq("id", id).eq("client_id", clientId);

      if (saveErr) return Response.json({ error: `draft written but not saved: ${saveErr.message}` }, { status: 500 });

      const dropped = draft.rejectedLinks?.length ?? 0;
      return backToItem(id,
        `Draft written · ${draft.wordCount} words · $${costUsd.toFixed(3)}` +
        (dropped ? ` · ${dropped} link${dropped === 1 ? "" : "s"} removed by policy` : "")
      );
    } catch (e) {
      if (e instanceof BudgetExceededError) return backToItem(id, e.message);
      return backToItem(id, `Draft failed: ${(e as Error).message}`);
    }
  }

  return Response.json({ error: `unknown action: ${action}` }, { status: 400 });
}
