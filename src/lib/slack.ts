// lib/slack.ts — internal ops alerts (collector failures), plus the low-level
// slackAlert() every other alerting module posts through.
// No-op (logs) when SLACK_WEBHOOK_URL is unset, so dev/test/CI never need Slack.
export async function slackAlert(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.warn("[slack] SLACK_WEBHOOK_URL unset — would have sent:", text);
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) console.error("[slack] webhook HTTP", res.status);
  } catch (e) {
    console.error("[slack] webhook failed:", (e as Error).message);
  }
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
