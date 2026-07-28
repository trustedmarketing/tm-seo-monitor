// api/qc/scan — run a crawl on demand, and collect it when it finishes.
//
// WO-003. Two genuine uses: confirming a change we published actually took
// effect, and checking a site the moment it launches rather than waiting for the
// next scheduled crawl.
//
// ── Why this is rate limited ─────────────────────────────────────────────────
// Punch list, smaller notes: "Confirm the QC 'Run scan now' has a rate limit —
// it triggers a crawl that costs money." A button that spends DataForSEO credits
// on every click, on a page a pod might refresh while waiting, is a bill nobody
// decided to run up.
//
// The limit is per client, not per user: the cost is per crawl, so two people
// clicking it is the same spend as one person clicking twice.
import { NextResponse } from "next/server";
import { getProfile, isAgency } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { onPageTaskPost, onPageSummary } from "@/lib/dataforseo";
import { classifyChecks, criticalIssues } from "@/lib/qc";
import { slackAlert } from "@/lib/slack";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Minimum gap between manual crawls of the same client. */
const COOLDOWN_HOURS = 6;
/** A crawl that has not finished in this long is treated as stuck, not running. */
const STALE_TASK_HOURS = 12;

function back(req: Request, clientId: string, msg: string) {
  const url = new URL(`/dashboard/${clientId}/qc`, req.url);
  url.searchParams.set("msg", msg);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(req: Request) {
  const profile = await getProfile();
  if (!isAgency(profile)) return NextResponse.json({ error: "Agency access required" }, { status: 403 });

  const form = await req.formData();
  const clientId = String(form.get("client_id") ?? "");
  const action = String(form.get("action") ?? "start");
  if (!clientId) return NextResponse.json({ error: "client_id required" }, { status: 400 });

  const db = dbClient();
  const { data: client } = await db
    .from("clients")
    .select("id, name, domain, onpage_task_id, onpage_task_started_at")
    .eq("id", clientId).maybeSingle();
  if (!client) return back(req, clientId, "not-found");

  // ── collect a finished crawl ───────────────────────────────────────────────
  if (action === "refresh") {
    if (!client.onpage_task_id) return back(req, clientId, "nothing-running");

    const summary = await onPageSummary(client.onpage_task_id);
    if (!summary) return back(req, clientId, "still-running");

    await db.from("qc_scans").insert({
      client_id: clientId,
      score: summary.score,
      pages_crawled: summary.crawledPages,
      checks: summary.checks,
      task_id: client.onpage_task_id,
    });

    // Same rule as the scheduled path: critical issues do not wait for anyone.
    const critical = criticalIssues(classifyChecks(summary.checks));
    if (critical.length) {
      const lines = critical.slice(0, 6).map((i) => `• ${i.label}: ${i.count} page(s)`);
      await slackAlert(`:rotating_light: *Critical site issues — ${client.name}*\n${lines.join("\n")}`);
    }

    await db.from("clients").update({
      onpage_task_id: null, onpage_task_started_at: null,
      last_crawl_at: new Date().toISOString(),
    }).eq("id", clientId);

    return back(req, clientId, critical.length ? "done-critical" : "done");
  }

  // ── start a crawl ──────────────────────────────────────────────────────────
  const startedAt = client.onpage_task_started_at ? new Date(client.onpage_task_started_at).getTime() : 0;
  const ageH = startedAt ? (Date.now() - startedAt) / 3_600_000 : Infinity;

  if (client.onpage_task_id && ageH < STALE_TASK_HOURS) {
    // Already crawling. Starting a second one would spend twice and give the
    // same answer.
    return back(req, clientId, "already-running");
  }

  if (!client.onpage_task_id) {
    const { data: recent } = await db
      .from("qc_scans").select("scanned_at")
      .eq("client_id", clientId).order("scanned_at", { ascending: false }).limit(1);
    const last = recent?.[0]?.scanned_at ? new Date(recent[0].scanned_at).getTime() : 0;
    if (last && (Date.now() - last) / 3_600_000 < COOLDOWN_HOURS) {
      return back(req, clientId, "cooldown");
    }
  }

  try {
    const taskId = await onPageTaskPost(client.domain);
    await db.from("clients").update({
      onpage_task_id: taskId,
      onpage_task_started_at: new Date().toISOString(),
      onpage_task_by: profile!.email,
    }).eq("id", clientId);

    await writeAudit(
      { action: "retry", targetType: "client", targetId: clientId, clientId,
        detail: `manual QC crawl queued for ${client.domain}` },
      profile
    );

    return back(req, clientId, "started");
  } catch (e) {
    return back(req, clientId, "failed");
  }
}
