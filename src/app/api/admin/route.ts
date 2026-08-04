// app/api/admin/route.ts — one admin endpoint, action-based.
// Auth: Authorization: Bearer <ADMIN_PASSWORD>. Server-side only writes.

import { createClient } from "@supabase/supabase-js";
import { rankedKeywords } from "@/lib/dataforseo";
import { dailyHistory, topQueries } from "@/lib/gsc";
import { buildClientRow } from "@/lib/clientProfile";

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function unauthorized(req: Request): boolean {
  return req.headers.get("authorization") !== `Bearer ${process.env.ADMIN_PASSWORD}`;
}

/**
 * Which organization a new client belongs to.
 *
 * Migration 012 made `clients.organization_id` NOT NULL and backfilled the rows
 * that existed, but nothing here ever set it — so every client added through
 * this endpoint since 2026-07-27 failed on the constraint. The two live clients
 * predate the migration, which is why it went unnoticed.
 *
 * This endpoint authenticates with a shared password rather than a Supabase
 * user, so there is no session to read an org from. With one organization the
 * answer is unambiguous; with more than one it must be stated, because silently
 * attaching a client to the wrong agency is not a mistake RLS would let you see
 * afterwards.
 */
async function resolveOrganizationId(
  s: ReturnType<typeof db>,
  explicit?: unknown
): Promise<string> {
  if (typeof explicit === "string" && explicit) return explicit;

  const { data, error } = await s.from("organizations").select("id, name").limit(2);
  if (error) throw error;
  if (!data?.length) throw new Error("No organization exists — run migration 012.");
  if (data.length > 1) {
    throw new Error("More than one organization exists; pass organization_id explicitly.");
  }
  return data[0].id as string;
}

export async function GET(req: Request) {
  if (unauthorized(req)) return new Response("Unauthorized", { status: 401 });
  const s = db();
  const { data: clients } = await s.from("clients").select("*").order("name");
  const { data: keywords } = await s
    .from("tracked_keywords").select("id, client_id, keyword").eq("active", true);
  const { data: prompts } = await s
    .from("tracked_prompts").select("id, client_id, prompt").eq("active", true);
  return Response.json({ clients: clients ?? [], keywords: keywords ?? [], prompts: prompts ?? [] });
}

export async function POST(req: Request) {
  if (unauthorized(req)) return new Response("Unauthorized", { status: 401 });
  const s = db();
  const body = await req.json();

  try {
    switch (body.action) {
      // ── Add / update a client ───────────────────────────────────
      // Validation and shaping live in lib/clientProfile so they can be tested
      // without a database, and so an UPDATE only writes the fields it was
      // actually given (see buildClientRow — this used to clobber the rest).
      case "upsert_client": {
        const { id, ...fields } = body;
        const built = buildClientRow(fields, id ? "update" : "insert");
        if ("error" in built) return Response.json({ error: built.error }, { status: 400 });

        const q = id
          ? s.from("clients").update(built.row).eq("id", id).select().single()
          : s.from("clients")
              .insert({ ...built.row, organization_id: await resolveOrganizationId(s, fields.organization_id) })
              .select().single();
        const { data, error } = await q;
        if (error) throw error;
        return Response.json({ client: data });
      }

      // ── Add keywords (array of strings) ─────────────────────────
      case "add_keywords": {
        const rows = (body.keywords as string[])
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean)
          .map((keyword) => ({ client_id: body.client_id, keyword }));
        const { error } = await s.from("tracked_keywords")
          .upsert(rows, { onConflict: "client_id,keyword" });
        if (error) throw error;
        return Response.json({ added: rows.length });
      }

      case "add_prompts": {
        const rows = (body.prompts as string[])
          .map((p) => p.trim())
          .filter(Boolean)
          .map((prompt) => ({ client_id: body.client_id, prompt }));
        const { error } = await s.from("tracked_prompts")
          .upsert(rows, { onConflict: "client_id,prompt" });
        if (error) throw error;
        return Response.json({ added: rows.length });
      }

      case "remove_prompt": {
        const { error } = await s.from("tracked_prompts")
          .update({ active: false }).eq("id", body.prompt_id);
        if (error) throw error;
        return Response.json({ ok: true });
      }

      case "remove_keyword": {
        const { error } = await s.from("tracked_keywords")
          .update({ active: false }).eq("id", body.keyword_id);
        if (error) throw error;
        return Response.json({ ok: true });
      }

      // ── Keyword suggestions: DataForSEO + GSC merged ────────────
      case "suggest_keywords": {
        const { data: c } = await s.from("clients").select("*").eq("id", body.client_id).single();
        if (!c) throw new Error("client not found");

        const [dfs, gsc] = await Promise.allSettled([
          rankedKeywords(c.domain, c.location_code, c.language_code, 40),
          c.gsc_property ? topQueries(c.gsc_property, 40) : Promise.resolve([]),
        ]);

        const suggestions = new Map<string, { keyword: string; source: string; note: string }>();
        if (gsc.status === "fulfilled") {
          for (const q of gsc.value) {
            suggestions.set(q.keyword, {
              keyword: q.keyword, source: "gsc",
              note: `${q.impressions} impressions · avg pos ${q.position}`,
            });
          }
        }
        if (dfs.status === "fulfilled") {
          for (const k of dfs.value) {
            if (!suggestions.has(k.keyword)) {
              suggestions.set(k.keyword, {
                keyword: k.keyword, source: "dataforseo",
                note: `${k.volume}/mo volume · pos ${k.position}`,
              });
            }
          }
        }
        return Response.json({
          suggestions: [...suggestions.values()],
          gsc_error: gsc.status === "rejected" ? String(gsc.reason) : null,
          dfs_error: dfs.status === "rejected" ? String(dfs.reason) : null,
        });
      }

      // ── GSC history backfill (16 months of daily rows) ──────────
      case "gsc_backfill": {
        const { data: c } = await s.from("clients").select("*").eq("id", body.client_id).single();
        if (!c?.gsc_property) throw new Error("Set the client's GSC property first");
        const history = await dailyHistory(c.gsc_property);
        const rows = history.map((h) => ({ client_id: c.id, ...h }));
        // upsert in chunks of 500
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await s.from("gsc_history")
            .upsert(rows.slice(i, i + 500), { onConflict: "client_id,date" });
          if (error) throw error;
        }
        return Response.json({ backfilled_days: rows.length });
      }

      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
