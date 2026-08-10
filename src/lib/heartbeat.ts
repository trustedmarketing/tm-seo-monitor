// lib/heartbeat.ts — dead-man's switch for the daily cron.
//
// Every other alert in this system fires from INSIDE the cron: collector
// failures, revenue mismatches, stale data. That leaves one failure mode
// uncovered, and it's the worst one — if the cron itself never runs (bad
// deploy, cron disabled in Vercel, function timeout, an unhandled throw before
// the alerting), nothing fires at all. Silence is indistinguishable from
// everything being fine. That is exactly how the Overview page's revenue bug
// sat unnoticed for a week.
//
// The fix has to live outside the thing being monitored. An external service
// (healthchecks.io, Cronitor, Better Stack) expects a ping on a schedule and
// alerts when one doesn't arrive. We can't detect our own absence; they can.
//
// Provider-agnostic on purpose — HEARTBEAT_URL is just a URL to GET. No-op when
// unset, matching slackAlert()'s convention, so dev/test/CI never need one.
const TIMEOUT_MS = 10_000;

export interface HeartbeatResult {
  configured: boolean;
  ok: boolean;
  error?: string;
}

/**
 * Pings HEARTBEAT_URL to report that the cron completed. Call it only on a
 * path that means "the run finished" — a ping sent regardless of outcome
 * would report health while the run was dying, which is worse than no ping.
 *
 * Never throws. A monitoring call that can fail the run it monitors defeats
 * the purpose, and a heartbeat that took down the collector would be a
 * genuinely absurd way to lose data.
 */
export async function pingHeartbeat(): Promise<HeartbeatResult> {
  const url = process.env.HEARTBEAT_URL;
  if (!url) {
    console.warn("[heartbeat] HEARTBEAT_URL unset — cron-stopped alerting is NOT active");
    return { configured: false, ok: false };
  }

  try {
    // Bounded: the cron is already near Vercel's 300s ceiling by this point,
    // and a hanging monitoring endpoint must not be what pushes it over.
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return { configured: true, ok: false, error: `HTTP ${res.status}` };
    }
    return { configured: true, ok: true };
  } catch (e) {
    // A failed ping is itself a signal: the external service will notice the
    // missing check-in and alert. Logging is all we can usefully do here.
    const error = (e as Error).message;
    console.error("[heartbeat] ping failed:", error);
    return { configured: true, ok: false, error };
  }
}
