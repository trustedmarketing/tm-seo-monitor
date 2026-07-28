// lib/slaEscalation.ts — give the SLA a consequence.
//
// WO-003 Stream F, punch list #9: "'4 cards past their 24-hour window' is
// displayed. Define what happens: notify pod lead at 24h, escalate to attention
// view at 48h. Otherwise the stale styling is decoration."
//
// The COO finding from 2026-07-27 is the argument for building this now rather
// than later: a collector failed for six days while the attention rail displayed
// it the whole time. That was an unowned surface, not a blind spot. An approval
// queue with an SLA and no consequence fails the same way — except the next time
// it will be in front of a client.
import { dbClient } from "@/lib/db";
import { slackAlert } from "@/lib/slack";

export type Breach = {
  id: string;
  client_id: string;
  clientName: string;
  title: string;
  hoursOver: number;
  level: "notify" | "escalate";
};

/** 24h → tell someone. 48h → it stops being one person's problem. */
export const NOTIFY_AFTER_H = 24;
export const ESCALATE_AFTER_H = 48;

export function levelFor(hoursOver: number): Breach["level"] | null {
  if (hoursOver >= ESCALATE_AFTER_H - NOTIFY_AFTER_H) return "escalate";
  if (hoursOver >= 0) return "notify";
  return null;
}

/**
 * Find every staged card past its SLA.
 *
 * Deliberately reads `sla_due_at` rather than recomputing from `created_at`:
 * different change classes will eventually carry different windows, and the
 * clock a card was given is the one it should be judged against.
 */
export async function findBreaches(): Promise<Breach[]> {
  const db = dbClient();
  const now = Date.now();

  const { data } = await db
    .from("approvals")
    .select("id, client_id, title, sla_due_at")
    .eq("status", "staged")
    .not("sla_due_at", "is", null)
    .lt("sla_due_at", new Date(now).toISOString());

  const rows = (data ?? []) as { id: string; client_id: string; title: string; sla_due_at: string }[];
  if (rows.length === 0) return [];

  const { data: clients } = await db.from("clients").select("id, name");
  const nameOf = new Map(((clients ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));

  return rows
    .map((r) => {
      const hoursOver = Math.floor((now - new Date(r.sla_due_at).getTime()) / 3_600_000);
      const level = levelFor(hoursOver);
      return level && {
        id: r.id, client_id: r.client_id, title: r.title,
        clientName: nameOf.get(r.client_id) ?? "unknown client",
        hoursOver, level,
      };
    })
    .filter(Boolean) as Breach[];
}

/**
 * Alert on SLA breaches.
 *
 * One message per run, not one per card. A queue that is badly behind would
 * otherwise produce a wall of notifications, and a wall of notifications is
 * indistinguishable from no notification — which is exactly how the GA4 failure
 * went unnoticed for six days.
 */
export async function reportBreaches(breaches: Breach[]): Promise<void> {
  if (breaches.length === 0) return;

  const escalated = breaches.filter((b) => b.level === "escalate");
  const notified = breaches.filter((b) => b.level === "notify");

  const lines: string[] = [];
  if (escalated.length) {
    lines.push(`*${escalated.length} card${escalated.length === 1 ? "" : "s"} past 48 hours — escalated*`);
    for (const b of escalated.slice(0, 10)) {
      lines.push(`• ${b.clientName} · ${b.title} (${b.hoursOver}h over)`);
    }
  }
  if (notified.length) {
    lines.push(`${notified.length} card${notified.length === 1 ? "" : "s"} past the 24-hour window`);
    for (const b of notified.slice(0, 10)) {
      lines.push(`• ${b.clientName} · ${b.title}`);
    }
  }
  // Say what was omitted rather than silently truncating — a count that
  // understates is the same failure as a count that overstates.
  const shown = Math.min(escalated.length, 10) + Math.min(notified.length, 10);
  if (breaches.length > shown) lines.push(`…and ${breaches.length - shown} more`);

  await slackAlert(`:hourglass: *Approvals past SLA*\n${lines.join("\n")}`);
}
