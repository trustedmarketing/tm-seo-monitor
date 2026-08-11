// api/clients/personas — create/update/delete a client's customer personas.
//
// WO-006 stream E. Same form-POST-with-redirect convention as
// api/clients/settings: agency-only, writes via the service-role db client,
// redirects back to /paid with a ?msg= code. Pure context — this never
// touches a platform's audience/targeting API (confirmed v1 scope); it only
// feeds ad copy and creative-generation prompts (streams C and F).
import { NextResponse } from "next/server";
import { getProfile, isAgency } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

function back(req: Request, clientId: string, msg: string) {
  const url = new URL(`/dashboard/${clientId}/paid`, req.url);
  url.searchParams.set("msg", msg);
  return NextResponse.redirect(url, { status: 303 });
}

/** Comma-separated input into a trimmed, deduped string array, or null if empty. */
function list(form: FormData, key: string): string[] | null {
  const raw = String(form.get(key) ?? "").trim();
  if (!raw) return null;
  const items = Array.from(new Set(raw.split(",").map((s) => s.trim()).filter(Boolean)));
  return items.length ? items : null;
}

function opt(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export async function POST(req: Request) {
  const profile = await getProfile();
  if (!isAgency(profile)) return NextResponse.json({ error: "Agency access required" }, { status: 403 });

  const form = await req.formData();
  const clientId = String(form.get("client_id") ?? "");
  const action = String(form.get("action") ?? "");
  if (!clientId) return NextResponse.json({ error: "client_id required" }, { status: 400 });

  const db = dbClient();

  if (action === "delete") {
    const personaId = String(form.get("persona_id") ?? "");
    if (!personaId) return back(req, clientId, "persona-not-found");

    await db.from("client_personas").delete().eq("id", personaId).eq("client_id", clientId);
    await writeAudit(
      { action: "decline", targetType: "client", targetId: personaId, clientId, detail: "persona deleted" },
      profile
    );
    return back(req, clientId, "persona-deleted");
  }

  if (action === "save") {
    const personaId = opt(form, "persona_id");
    const name = opt(form, "name");
    if (!name) return back(req, clientId, "persona-name-required");

    const patch = {
      client_id: clientId,
      name,
      description: opt(form, "description"),
      locations: list(form, "locations"),
      categories: list(form, "categories"),
      pain_points: opt(form, "pain_points"),
      messaging_angle: opt(form, "messaging_angle"),
      updated_at: new Date().toISOString(),
    };

    if (personaId) {
      await db.from("client_personas").update(patch).eq("id", personaId).eq("client_id", clientId);
    } else {
      await db.from("client_personas").insert(patch);
    }

    await writeAudit(
      { action: "approve", targetType: "client", targetId: personaId ?? null, clientId,
        detail: `persona ${personaId ? "updated" : "created"}: ${name}` },
      profile
    );
    return back(req, clientId, personaId ? "persona-updated" : "persona-created");
  }

  return back(req, clientId, "unknown-action");
}
