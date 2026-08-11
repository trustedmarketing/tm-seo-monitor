// lib/slack.ts — internal ops alerts (collector failures), the low-level
// slackAlert() every other alerting module posts through, and slackAlertTo()
// for posting to an arbitrary webhook.
//
// Two audiences, deliberately kept apart: SLACK_WEBHOOK_URL is ONE internal ops
// channel (failures, token expiry, SLA breaches, revenue mismatches), while
// slackAlertTo() carries the daily brief to each client's own channel. Pointing
// the internal alerts at a client channel would deliver every other client's
// revenue and spend figures into it.
//
// No-op (logs) when SLACK_WEBHOOK_URL is unset, so dev/test/CI never need Slack.

// Posts to an arbitrary incoming webhook URL (e.g. a client's own channel).
// Returns whether the post succeeded, rather than throwing, so one client's
// bad/revoked webhook can't take down the others in the same run.
export async function slackAlertTo(url: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) console.error("[slack] webhook HTTP", res.status);
    return res.ok;
  } catch (e) {
    console.error("[slack] webhook failed:", (e as Error).message);
    return false;
  }
}

export async function slackAlert(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.warn("[slack] SLACK_WEBHOOK_URL unset — would have sent:", text);
    return;
  }
  await slackAlertTo(url, text);
}

export interface CollectorFailure {
  module: string;
  client: string;
  error: string;
}

// Alert on collector failures surfaced in a run. No failures → no message.
export async function alertOnFailures(runAt: string, failures: CollectorFailure[]): Promise<void> {
  if (failures.length === 0) return;
  const lines = failures.map((f) => `• *${f.client}* / ${f.module}: ${f.error}`).join("\n");
  await slackAlert(
    `:rotating_light: *Growth OS collector* — ${failures.length} failure(s) at ${runAt}\n${lines}`
  );
}

// Staleness alerting lives in lib/accuracyAlerts.ts, not here — it goes through
// notify() so it reaches email as well as Slack. The unused Slack-only
// alertOnStaleness() that sat here was never called by anything.
