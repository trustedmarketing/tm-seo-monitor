import { getProfile, isAgency } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";

const REC_STATUSES = ["open", "approved", "measuring", "validated", "no_effect", "dismissed", "resolved"];

export async function POST(req: Request) {
  // Recommendation triage is everyday pod work, so any agency role may do it.
  // Client users must never reach this route.
  const profile = await getProfile();
  if (!isAgency(profile)) return Response.json({ error: "Agency access required" }, { status: 401 });

  // Service role: these are writes across client rows by an authorized agency
  // user, and the RLS policies from 012 are read-only by design.
  const db = dbClient();
  const body = await req.json();

  try {
    switch (body.action) {
      case "rec_status": {
        if (!REC_STATUSES.includes(body.status)) throw new Error("bad status");
        const { error } = await db.from("recommendations").update({
          status: body.status, updated_at: new Date().toISOString(),
        }).eq("id", body.id);
        if (error) throw error;
        return Response.json({ ok: true });
      }

      case "log_change": {
        const { client_id, title, description, changed_at, affected_keywords, recommendation_id } = body;
        if (!client_id || !title || !changed_at) throw new Error("client, title, and date are required");
        const { data, error } = await db.from("changes").insert({
          client_id, title,
          description: description || null,
          changed_at,
          affected_keywords: Array.isArray(affected_keywords) && affected_keywords.length ? affected_keywords : null,
          recommendation_id: recommendation_id || null,
          source: "manual",
        }).select().single();
        if (error) throw error;
        if (recommendation_id) {
          await db.from("recommendations").update({
            status: "measuring", shipped_at: new Date(changed_at).toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", recommendation_id);
        }
        return Response.json({ change: data });
      }

      case "delete_change": {
        const { error } = await db.from("changes").delete().eq("id", body.id);
        if (error) throw error;
        return Response.json({ ok: true });
      }

      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
