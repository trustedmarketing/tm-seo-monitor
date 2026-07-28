// lib/declinePolicy.ts — what a decline actually means.
//
// WO-003. Spec §2: "Decline requires a reason (dropdown: wrong direction / bad
// timing / client said no / other) — decline reasons feed the learning layer."
//
// The first implementation suppressed everything for 60 days regardless of
// reason, which throws away the entire signal. The four reasons are not
// variations on "no" — they are four different statements:
//
//   bad timing      → the proposal was RIGHT. Ask again soon.
//   wrong direction → the proposal was WRONG. The rule can try once more,
//                     differently, then stop.
//   client said no  → the CLIENT decided. Not our call to keep re-asking.
//   other           → we do not know yet, so it needs a human note.
//
// Treating "ask me next month" the same as "the client refused this" is how a
// queue becomes noise in one direction and how you nag a client in the other.

export type DeclineReason = "bad timing" | "wrong direction" | "client said no" | "other";

export type DeclinePolicy = {
  /** Days before this exact proposal may be staged again. */
  suppressDays: number;
  /**
   * Whether the engine should try an ALTERNATIVE phrasing next time rather than
   * re-proposing the same value. Only meaningful when the value itself was the
   * problem.
   */
  redraft: boolean;
  /** Shown on the card so the next person understands what happened. */
  label: string;
  /** Whether a free-text note is required to make the decline useful. */
  requiresNote: boolean;
};

export const DECLINE_POLICY: Record<DeclineReason, DeclinePolicy> = {
  "bad timing": {
    // Short: the work was approved in principle, just not now. A 60-day
    // suppression here silently kills a good proposal.
    suppressDays: 14,
    redraft: false,
    label: "Right idea, wrong moment — it will come back in two weeks",
    requiresNote: false,
  },
  "wrong direction": {
    // The VALUE was wrong, not the intent. Let the rule try once more with a
    // different phrasing; if that is refused too, the long window applies.
    suppressDays: 30,
    redraft: true,
    label: "The suggestion was wrong — the rule will try a different angle once",
    requiresNote: false,
  },
  "client said no": {
    // A client decision, not a quality signal. Re-asking is how an agency
    // becomes annoying, and no rule should overrule it on a schedule.
    suppressDays: 365,
    redraft: false,
    label: "The client decided against this — it will not be suggested again this year",
    requiresNote: false,
  },
  other: {
    // We genuinely do not know why, so the note is what makes it learnable.
    suppressDays: 60,
    redraft: false,
    label: "Declined — see the note",
    requiresNote: true,
  },
};

export function policyFor(reason: string): DeclinePolicy {
  return DECLINE_POLICY[reason as DeclineReason] ?? DECLINE_POLICY.other;
}

export function suppressUntil(reason: string, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + policyFor(reason).suppressDays);
  return d.toISOString().slice(0, 10);
}
