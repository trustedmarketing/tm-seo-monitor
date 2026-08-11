// lib/notify.ts — tell someone, on whatever channel exists.
//
// WO-004. Slack is wired and working; email is not. Rather than block a decline
// alert on an email provider nobody has signed up for yet, this sends on every
// channel that is configured and says nothing when none is.
//
// Email uses Resend if RESEND_API_KEY and ALERT_EMAIL_TO are set. Adding the key
// turns email on with no code change.
import { slackAlert } from "@/lib/slack";

export type Notification = {
  subject: string;
  /** Plain text. Slack gets it as-is; email wraps it. */
  body: string;
};

export interface EmailResult {
  ok: boolean;
  /** Why it failed — the missing env var, or Resend's own message. */
  error?: string;
}

/**
 * The one Resend send path.
 *
 * Shared so module/daily-brief can send to its own recipient list without
 * duplicating the fetch, and so the diagnostics live in ONE place: getting
 * email working took three separate misconfigurations (default sender, missing
 * recipient, unverified domain) and every one of them looked fine from the
 * Vercel dashboard. A second copy of this call would have needed all three
 * lessons re-learned.
 *
 * Never throws. Returns WHY it failed rather than a bare false, because
 * "unverified domain", "test-mode recipient restriction" and "bad API key" are
 * indistinguishable otherwise.
 */
export async function sendResendEmail(opts: {
  subject: string; text: string; to: string | undefined; from?: string;
}): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  const to = opts.to;

  // Both are required. Saying WHICH is missing matters: a Resend key with no
  // recipient looks configured and sends nothing at all.
  if (!key || !to) {
    return {
      ok: false,
      error: !key && !to
        ? "RESEND_API_KEY and recipient both unset"
        : !key ? "RESEND_API_KEY unset" : "recipient unset",
    };
  }

  // ALERT_EMAIL_FROM is optional in theory and required in practice: Resend only
  // lets the default onboarding@resend.dev sender deliver to the account owner's
  // own address, so it works in a first test and fails for everyone else.
  const from = opts.from ?? process.env.ALERT_EMAIL_FROM ?? "Growth OS <onboarding@resend.dev>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: to.split(",").map((t) => t.trim()).filter(Boolean),
        subject: opts.subject,
        text: opts.text,
      }),
    });
    if (res.ok) return { ok: true };
    const body = await res.text().catch(() => "");
    return { ok: false, error: `Resend HTTP ${res.status}: ${body.slice(0, 300)}` };
  } catch (e) {
    return { ok: false, error: `fetch failed: ${(e as Error).message}` };
  }
}

export async function notify(
  n: Notification
): Promise<{ slack: boolean; email: boolean; emailError?: string }> {
  const out: { slack: boolean; email: boolean; emailError?: string } = { slack: false, email: false };

  // Both are attempted independently: a broken email provider must not swallow
  // a Slack alert that would otherwise have reached someone.
  try {
    await slackAlert(`*${n.subject}*\n${n.body}`);
    out.slack = true;
  } catch {
    // slackAlert already no-ops when unconfigured; a throw here is a real failure
    // and still must not stop the email.
  }

  const sent = await sendResendEmail({
    subject: n.subject,
    text: n.body,
    to: process.env.ALERT_EMAIL_TO,
  });
  out.email = sent.ok;
  if (sent.error) {
    // Name ALERT_EMAIL_TO specifically — sendResendEmail is shared, so it can
    // only say "recipient unset", and knowing which env var to set is the
    // difference between a two-minute fix and an afternoon of guessing.
    out.emailError = sent.error === "recipient unset" ? "ALERT_EMAIL_TO unset"
      : sent.error === "RESEND_API_KEY and recipient both unset" ? "RESEND_API_KEY and ALERT_EMAIL_TO both unset"
      : sent.error;
  }

  return out;
}
