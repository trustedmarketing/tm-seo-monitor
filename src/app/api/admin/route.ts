// app/api/admin/route.ts — one admin endpoint, action-based.
// Auth: Authorization: Bearer <ADMIN_PASSWORD>. Server-side only writes.

import { createClient } from "@supabase/supabase-js";
import { rankedKeywords } from "@/lib/dataforseo";
import { dailyHistory, topQueries } from "@/lib/gsc";

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function unauthorized(req: Request): boolean {
  return req.headers.get("authorization") !== `Bearer ${process.env.ADMIN_PASSWORD}`;
}

export async function GET(req: Request) {
  if (unauthorized(req)) return new Response("Unauthorized", { status: 401 });
  const s = db();
  const { data: clients } = await s.from("clients").select("*").order("name");
  const { data: keywords } = await s
    .from("tracked_keywords").select("id, client_id, keyword").eq("active", true);
  return Response.json({ clients: clients ?? [], keywords: keywords ?? [] });
}

export async function POST(req: Request) {
  if (unauthorized(req)) return new Response("Unauthorized", { status: 401 });
  const s = db();
  const body = await req.json();

  try {
    switch (body.action) {
      // ── Add / update a client ───────────────────────────────────
      case "upsert_client": {
        const { id, name, domain, tier, location_code, gsc_property,
                core_frequency, serp_frequency, crawl_frequency } = body;
        const row = {
          name, domain: domain?.replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
          tier: tier || null,
          location_code: location_code || 2840,
          gsc_property: gsc_property || null,
          core_frequency: core_frequency || "weekly",
          serp_frequency: serp_frequency || "weekly",
          crawl_frequency: crawl_frequency || "monthly",
        };
        const q = id
          ? s.from("clients").update(row).eq("id", id).select().single()
          : s.from("clients").insert(row).select().single();
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
