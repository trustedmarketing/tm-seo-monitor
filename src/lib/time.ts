// lib/time.ts — every date on screen, in the team's timezone.
//
// WO-003. Server components render on Vercel, which runs in UTC, so any bare
// `toLocaleDateString()` silently rendered UTC. That is wrong in two ways:
//
//   · "Last crawl 2:04 PM" meant 10:04 AM to everyone reading it
//   · the daily cron fires at 10:00 UTC — 6am Eastern — so a run could appear
//     dated a day ahead of the working day it belongs to
//
// `America/New_York` rather than a fixed -5 offset, so daylight saving is
// handled rather than being wrong for eight months of the year.
//
// If TM ever operates across timezones this becomes a per-user preference. Until
// then one office means one zone, and one place to change it.
export const TZ = "America/New_York";

const date = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" });
const dateFull = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "short", day: "numeric" });
const time = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const dateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

type When = string | number | Date | null | undefined;

function d(v: When): Date | null {
  if (v == null) return null;
  const parsed = v instanceof Date ? v : new Date(v);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "Jul 28" */
export function fmtDate(v: When, fallback = "—"): string {
  const x = d(v); return x ? date.format(x) : fallback;
}

/** "Monday, Jul 28" */
export function fmtDateFull(v: When, fallback = "—"): string {
  const x = d(v); return x ? dateFull.format(x) : fallback;
}

/** "2:04 PM" */
export function fmtTime(v: When, fallback = "—"): string {
  const x = d(v); return x ? time.format(x) : fallback;
}

/** "Jul 28, 2:04 PM" */
export function fmtDateTime(v: When, fallback = "—"): string {
  const x = d(v); return x ? dateTime.format(x) : fallback;
}

/**
 * "3h ago" — relative, so it needs no timezone at all.
 *
 * Preferred for freshness because it is unambiguous: a reader does not have to
 * work out whether a timestamp is theirs or the server's.
 */
export function fmtAgo(v: When, fallback = "no data"): string {
  const x = d(v);
  if (!x) return fallback;
  const mins = Math.floor((Date.now() - x.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}
