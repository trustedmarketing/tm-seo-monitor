// lib/accuracyAlerts.ts — the "your numbers are wrong / your numbers stopped"
// alerts, on whatever channel is configured.
//
// Routed through lib/notify.ts rather than slackAlert() directly, unlike the
// collector-failure alerts: those are ops noise for whoever is watching the
// channel, but these are the ones Tom personally needs to see. notify() sends
// on Slack AND email independently, so setting RESEND_API_KEY + ALERT_EMAIL_TO
// turns email on with no code change here — and a missing Slack webhook can no
// longer silently swallow the alert.
//
// Lives here rather than in lib/slack.ts because slack.ts is what notify.ts
// imports; putting a notify() call inside it would be a circular import.
import { notify } from "@/lib/notify";
import type { StaleSource } from "@/lib/dataFreshness";

export interface RevenueMismatch {
  client: string;
  storedRevenue: number;
  freshRevenue: number;
  diffAbs: number;
  diffPct: number | null;
}

// Alert when a client's stored Shopify revenue disagrees with a fresh pull from
// Shopify itself, past checkShopifyReconciliation()'s tolerance. One batched
// message, not one per client (same convention as alertOnFailures).
export async function alertOnRevenueMismatch(runAt: string, mismatches: RevenueMismatch[]): Promise<void> {
  if (mismatches.length === 0) return;
  const lines = mismatches.map((m) => {
    const pct = m.diffPct != null ? ` (${(m.diffPct * 100).toFixed(1)}%)` : "";
    return `• ${m.client}: we show $${m.storedRevenue.toFixed(2)}, Shopify shows $${m.freshRevenue.toFixed(2)} — off by $${m.diffAbs.toFixed(2)}${pct}`;
  });
  await notify({
    subject: `Growth OS: revenue doesn't match Shopify for ${mismatches.length} client(s)`,
    body: [`Checked at ${runAt}.`, "", ...lines].join("\n"),
  });
}

// Alert when a source that HAS reported before has gone quiet — the failure
// mode where nothing errors and the dashboard just stops moving.
export async function alertOnStaleData(runAt: string, stale: StaleSource[]): Promise<void> {
  if (stale.length === 0) return;
  const lines = stale.map(
    (s) => `• ${s.client} / ${s.module}: no new data for ${Math.floor(s.hoursOld / 24)} day(s) (${s.hoursOld}h)`
  );
  await notify({
    subject: `Growth OS: data has stopped updating for ${stale.length} source(s)`,
    body: [`Checked at ${runAt}.`, "", ...lines].join("\n"),
  });
}
