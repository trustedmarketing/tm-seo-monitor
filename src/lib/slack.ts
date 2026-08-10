// lib/slack.ts — internal ops alerts (collector failure + data staleness).
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

// Alert when a client's freshest data is older than the staleness threshold (default 36h).
export async function alertOnStaleness(
  stale: { client: string; module: string; hoursOld: number }[]
): Promise<void> {
  if (stale.length === 0) return;
  const lines = stale
    .map((s) => `• *${s.client}* / ${s.module}: ${s.hoursOld}h since last fresh data`)
    .join("\n");
  await slackAlert(`:hourglass: *Growth OS staleness* — ${stale.length} client(s) stale\n${lines}`);
}

export interface RevenueMismatch {
  client: string;
  storedRevenue: number;
  freshRevenue: number;
  diffAbs: number;
  diffPct: number | null;
}

// Alert when a client's stored 30-day Shopify revenue disagrees with a fresh
// pull from Shopify itself, past checkShopifyReconciliation()'s tolerance.
// Also the alert that fires when data has quietly stopped updating: a frozen
// collector leaves storedRevenue behind while freshRevenue keeps climbing
// with real new orders, which is a mismatch by the time it's noticed.
export async function alertOnRevenueMismatch(runAt: string, mismatches: RevenueMismatch[]): Promise<void> {
  if (mismatches.length === 0) return;
  const lines = mismatches
    .map((m) => {
      const pct = m.diffPct != null ? ` (${(m.diffPct * 100).toFixed(1)}%)` : "";
      return `• *${m.client}*: stored $${m.storedRevenue.toFixed(2)} vs Shopify $${m.freshRevenue.toFixed(2)} — off by $${m.diffAbs.toFixed(2)}${pct}`;
    })
    .join("\n");
  await slackAlert(
    `:warning: *Growth OS revenue mismatch* — ${mismatches.length} client(s) disagree with Shopify at ${runAt}\n${lines}`
  );
}
