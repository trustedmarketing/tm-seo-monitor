// lib/adSpendGuard.ts — WO-006 stream D: the hard guardrail (spec §7).
//
// "Every write action passes through a spend-guard layer — per-client daily
// and monthly spend ceilings stored in the DB; any action that could exceed
// them is blocked and escalated, not approved-through." This is a pure
// check against already-fetched rows — no I/O — so approvals/route.ts calls
// it synchronously right before dispatching to an adapter, and the caller
// decides how to escalate a block (Slack, same pattern as slaEscalation.ts).
export interface SpendGuardRow {
  daily_ceiling: number | null;
  monthly_ceiling: number | null;
}

export interface SpendGuardCheck {
  /** The daily budget the campaign would have AFTER this action. */
  projectedDailyBudget: number;
  /** Spend already committed this month across the client's OTHER campaigns
   * on this platform, so one campaign's budget change is judged against the
   * account's real exposure, not in isolation. */
  otherCampaignsMonthlyBudget: number;
}

export type SpendGuardResult =
  | { blocked: false }
  | { blocked: true; reason: string };

// A month is approximated as 30 days of the projected daily budget, matching
// how ad platforms themselves estimate monthly spend from a daily budget —
// exact billing-calendar accuracy isn't the point here, catching a runaway
// budget change before it executes is.
const DAYS_PER_MONTH = 30;

export type CeilingParse =
  | { ok: true; value: number | null }
  | { ok: false; reason: string };

/**
 * A ceiling typed into the settings form → the number stored, or an error.
 *
 * Blank means "no ceiling" (null), which is a real and deliberate choice, not a
 * validation failure — the guard treats a missing row as unenforced. Everything
 * else has to be a non-negative finite number, because a ceiling that silently
 * parsed to NaN would disable the guardrail while looking configured, which is
 * the worst of both.
 *
 * Zero is allowed and means a hard stop: no spend permitted at all.
 */
export function parseCeiling(raw: string | null | undefined): CeilingParse {
  const s = String(raw ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (s === "") return { ok: true, value: null };

  const n = Number(s);
  if (!Number.isFinite(n)) return { ok: false, reason: `"${raw}" is not a number` };
  if (n < 0) return { ok: false, reason: "a ceiling cannot be negative" };
  return { ok: true, value: n };
}

export function checkSpendGuard(guard: SpendGuardRow | null, check: SpendGuardCheck): SpendGuardResult {
  if (!guard) return { blocked: false }; // no ceiling configured — nothing to enforce

  if (guard.daily_ceiling != null && check.projectedDailyBudget > guard.daily_ceiling) {
    return {
      blocked: true,
      reason: `projected daily budget $${check.projectedDailyBudget.toFixed(0)} exceeds the $${guard.daily_ceiling.toFixed(0)} daily ceiling for this client/platform`,
    };
  }

  if (guard.monthly_ceiling != null) {
    const projectedMonthly = check.otherCampaignsMonthlyBudget + check.projectedDailyBudget * DAYS_PER_MONTH;
    if (projectedMonthly > guard.monthly_ceiling) {
      return {
        blocked: true,
        reason: `projected monthly spend $${projectedMonthly.toFixed(0)} exceeds the $${guard.monthly_ceiling.toFixed(0)} monthly ceiling for this client/platform`,
      };
    }
  }

  return { blocked: false };
}
