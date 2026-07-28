// lib/campaignDates.ts — read the dates out of a campaign line.
//
// WO-004. "Student sale from the 8th to the 15th" has to schedule inside that
// window. A post advertising a sale three days before it opens is worse than no
// post: it sends people to a page that is not live yet.
//
// ── Why parse free text rather than add date fields ──────────────────────────
// The brief is written by a person in a hurry, in their own words. A form with
// start and end pickers per line would be more precise and would not get used —
// the value of the box is that you can type what you already know. So this
// reads what people actually write, and the plan SHOWS what it understood so a
// misread is visible rather than silent.
//
// Everything is day-of-month within the plan's month. That covers "from the 8th",
// "8th-15th", "on the 14th". A campaign spanning months is not something this
// tries to guess at.

export type CampaignWindow = {
  /** Day of month, 1-31. */
  from: number | null;
  to: number | null;
  /** How the dates were expressed, for showing back to the reader. */
  label: string | null;
};

const ORDINAL = /(\d{1,2})\s*(?:st|nd|rd|th)?/;

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";

/**
 * Pull a date window out of one campaign line.
 *
 * Ranges are tried before single dates: "from the 8th to the 15th" contains
 * "the 8th", and matching that first would turn a nine-day sale into one day.
 */
export function parseWindow(line: string): CampaignWindow {
  const text = line.toLowerCase();

  // ── ranges ───────────────────────────────────────────────────────────────
  // "8th to 15th", "8-15", "8th – 15th", "from the 8th through the 15th",
  // "Aug 8 to Aug 15"
  const range = text.match(
    new RegExp(
      `(?:from\\s+)?(?:the\\s+)?(?:${MONTHS})?[a-z]*\\s*${ORDINAL.source}` +
      `\\s*(?:-|–|—|to|until|till|through|thru)\\s*` +
      `(?:the\\s+)?(?:${MONTHS})?[a-z]*\\s*${ORDINAL.source}`,
      "i"
    )
  );

  if (range) {
    const from = clampDay(Number(range[1]));
    const to = clampDay(Number(range[2]));
    if (from && to) {
      return { from, to, label: `${ordinal(from)} to ${ordinal(to)}` };
    }
  }

  // ── open-ended start ─────────────────────────────────────────────────────
  // "from the 8th", "starts on the 8th", "8th onwards"
  const start = text.match(
    new RegExp(`(?:from|starts?(?:\\s+on)?|beginning|as of)\\s+(?:the\\s+)?(?:${MONTHS})?[a-z]*\\s*${ORDINAL.source}`, "i")
  );
  if (start) {
    const from = clampDay(Number(start[1]));
    if (from) return { from, to: null, label: `from the ${ordinal(from)}` };
  }

  // ── a single date ────────────────────────────────────────────────────────
  // "on the 14th", "the 14th", "Aug 14"
  const single = text.match(
    new RegExp(`(?:on\\s+)?the\\s+${ORDINAL.source}|(?:${MONTHS})[a-z]*\\s+${ORDINAL.source}`, "i")
  );
  if (single) {
    const day = clampDay(Number(single[1] ?? single[2]));
    // A single date is a moment, not a window — the post lands on the day.
    if (day) return { from: day, to: day, label: `on the ${ordinal(day)}` };
  }

  return { from: null, to: null, label: null };
}

function clampDay(n: number): number | null {
  return Number.isFinite(n) && n >= 1 && n <= 31 ? n : null;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/**
 * Dates to post on for a campaign, inside its window.
 *
 * A single-day campaign posts on the day and, if it has more than one slot, on
 * the days immediately before — a launch wants a run-up, not two posts stacked
 * on the same morning.
 */
export function datesInWindow(
  monthStart: Date,
  win: CampaignWindow,
  slots: number
): string[] {
  const year = monthStart.getUTCFullYear();
  const mon = monthStart.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, mon + 1, 0)).getUTCDate();

  const from = Math.min(win.from ?? 1, daysInMonth);
  const to = Math.min(win.to ?? daysInMonth, daysInMonth);

  const out: string[] = [];

  if (from === to) {
    // Count backwards from the day so the last post lands ON it.
    for (let i = slots - 1; i >= 0; i--) {
      const day = Math.max(1, from - i * 2);
      out.push(iso(year, mon, day));
    }
    return out;
  }

  const span = Math.max(1, to - from);
  for (let i = 0; i < slots; i++) {
    // Spread across the window rather than clustering at the start: a sale
    // needs reminding about while it is running, not only when it opens.
    const day = slots === 1 ? from : from + Math.round((span * i) / (slots - 1));
    out.push(iso(year, mon, Math.min(day, daysInMonth)));
  }
  return out;
}

function iso(year: number, mon: number, day: number): string {
  return new Date(Date.UTC(year, mon, day)).toISOString().slice(0, 10);
}
