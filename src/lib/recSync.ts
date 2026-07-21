// lib/recSync.ts — persist recommendations per collection, measure shipped changes.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildRecommendations } from "@/lib/recommendations";

// ── Sync: recompute rules from latest data, upsert preserving status ──
export async function syncRecommendations(db: SupabaseClient, clientId: string) {
  const [{ data: snaps }, { data: kws }, { data: ranks }, { data: tprompts }, { data: presults }] =
    await Promise.all([
      db.from("metric_snapshots").select("*").eq("client_id", clientId)
        .order("captured_at", { ascending: false }).limit(2),
      db.from("tracked_keywords").select("id, keyword").eq("client_id", clientId).eq("active", true),
      db.from("keyword_rankings").select("keyword_id, position, url, checked_at").eq("client_id", clientId)
        .order("checked_at", { ascending: false }).limit(400),
      db.from("tracked_prompts").select("id, prompt").eq("client_id", clientId).eq("active", true),
      db.from("prompt_results").select("prompt_id, mentioned, cited, checked_at").eq("client_id", clientId)
        .order("checked_at", { ascending: false }).limit(200),
    ]);

  const [cur, prev] = (snaps ?? []) as any[];

  const byKw = new Map<string, any[]>();
  for (const r of (ranks ?? []) as any[]) {
    const list = byKw.get(r.keyword_id) ?? [];
    if (list.length < 2) { list.push(r); byKw.set(r.keyword_id, list); }
  }
  const kwRows = ((kws ?? []) as any[]).map((k) => {
    const [rCur, rPrev] = byKw.get(k.id) ?? [];
    return {
      keyword: k.keyword,
      position: rCur?.position ?? null,
      url: rCur?.url ?? null,
      posDelta: rCur?.position != null && rPrev?.position != null ? rPrev.position - rCur.position : null,
    };
  });

  const latestResult = new Map<string, any>();
  for (const r of (presults ?? []) as any[]) {
    if (!latestResult.has(r.prompt_id)) latestResult.set(r.prompt_id, r);
  }
  const promptRows = ((tprompts ?? []) as any[]).map((tp) => {
    const r = latestResult.get(tp.id);
    return { prompt: tp.prompt, mentioned: r ? r.mentioned : null, cited: r ? r.cited : null };
  });

  const recs = buildRecommendations(cur, prev, kwRows, promptRows);
  const activeKeys = recs.map((r) => r.key);

  const { data: existing } = await db.from("recommendations")
    .select("id, rule_key, status").eq("client_id", clientId);
  const byKey = new Map((existing ?? []).map((e: any) => [e.rule_key, e]));

  for (const r of recs) {
    const row = byKey.get(r.key);
    if (row) {
      // refresh content; never touch status/lifecycle fields
      await db.from("recommendations").update({
        severity: r.severity, category: r.category, title: r.title, detail: r.detail,
        updated_at: new Date().toISOString(),
        // a resolved rec that fires again reopens
        ...(row.status === "resolved" ? { status: "open" } : {}),
      }).eq("id", row.id);
    } else {
      await db.from("recommendations").insert({
        client_id: clientId, rule_key: r.key, severity: r.severity,
        category: r.category, title: r.title, detail: r.detail, status: "open",
      });
    }
  }

  // rules that stopped firing: auto-resolve if still open/approved
  const gone = (existing ?? []).filter(
    (e: any) => !activeKeys.includes(e.rule_key) && ["open", "approved"].includes(e.status)
  );
  for (const g of gone) {
    await db.from("recommendations").update({
      status: "resolved", updated_at: new Date().toISOString(),
    }).eq("id", (g as any).id);
  }
}

// ── Measurement: 28d before vs 28d after each unmeasured change ──
const WINDOW_DAYS = 28;

function iso(d: Date): string { return d.toISOString().slice(0, 10); }

export async function measureChanges(db: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const { data: due } = await db.from("changes")
    .select("*").is("measured_at", null).lte("changed_at", iso(cutoff));

  let measured = 0;
  for (const ch of (due ?? []) as any[]) {
    const changed = new Date(ch.changed_at);
    const beforeStart = new Date(changed); beforeStart.setDate(beforeStart.getDate() - WINDOW_DAYS);
    const afterEnd = new Date(changed); afterEnd.setDate(afterEnd.getDate() + WINDOW_DAYS);

    // GSC clicks, domain-level
    const [{ data: before }, { data: after }] = await Promise.all([
      db.from("gsc_history").select("clicks, impressions").eq("client_id", ch.client_id)
        .gte("date", iso(beforeStart)).lt("date", iso(changed)),
      db.from("gsc_history").select("clicks, impressions").eq("client_id", ch.client_id)
        .gt("date", iso(changed)).lte("date", iso(afterEnd)),
    ]);
    const sum = (rows: any[] | null, f: string) => (rows ?? []).reduce((s, r) => s + (r[f] ?? 0), 0);
    const clicksBefore = sum(before, "clicks");
    const clicksAfter = sum(after, "clicks");
    const hasGsc = (before ?? []).length > 0 && (after ?? []).length > 0;

    // avg position of affected tracked keywords, before vs after
    let posBefore: number | null = null;
    let posAfter: number | null = null;
    if (Array.isArray(ch.affected_keywords) && ch.affected_keywords.length > 0) {
      const { data: kwIds } = await db.from("tracked_keywords")
        .select("id").eq("client_id", ch.client_id).in("keyword", ch.affected_keywords);
      const ids = (kwIds ?? []).map((k: any) => k.id);
      if (ids.length > 0) {
        const [{ data: rb }, { data: ra }] = await Promise.all([
          db.from("keyword_rankings").select("position").in("keyword_id", ids)
            .gte("checked_at", beforeStart.toISOString()).lt("checked_at", changed.toISOString()),
          db.from("keyword_rankings").select("position").in("keyword_id", ids)
            .gt("checked_at", changed.toISOString()).lte("checked_at", afterEnd.toISOString()),
        ]);
        const avg = (rows: any[] | null) => {
          const ps = (rows ?? []).map((r) => r.position).filter((p) => p != null) as number[];
          return ps.length ? Math.round((ps.reduce((s, p) => s + p, 0) / ps.length) * 10) / 10 : null;
        };
        posBefore = avg(rb); posAfter = avg(ra);
      }
    }

    // verdict
    let verdict = "inconclusive";
    const clicksPct = clicksBefore > 0 ? ((clicksAfter - clicksBefore) / clicksBefore) * 100 : null;
    const posImproved = posBefore != null && posAfter != null ? posBefore - posAfter : null; // positive = moved up
    if (hasGsc || posImproved != null) {
      const goodClicks = clicksPct != null && clicksPct >= 10;
      const badClicks = clicksPct != null && clicksPct <= -10;
      const goodPos = posImproved != null && posImproved >= 2;
      const badPos = posImproved != null && posImproved <= -2;
      if (goodClicks || goodPos) verdict = "improved";
      else if (badClicks || badPos) verdict = "declined";
      else verdict = "flat";
    }

    const metrics = {
      window_days: WINDOW_DAYS,
      clicks_before: hasGsc ? clicksBefore : null,
      clicks_after: hasGsc ? clicksAfter : null,
      clicks_pct: clicksPct != null ? Math.round(clicksPct * 10) / 10 : null,
      avg_position_before: posBefore,
      avg_position_after: posAfter,
    };

    await db.from("changes").update({
      verdict, metrics, measured_at: new Date().toISOString(),
    }).eq("id", ch.id);

    if (ch.recommendation_id) {
      await db.from("recommendations").update({
        status: verdict === "improved" ? "validated" : "no_effect",
        measured_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", ch.recommendation_id);
    }
    measured++;
  }
  return measured;
}
