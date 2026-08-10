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

// Shared Resend send path, factored out so module/daily-brief can send to its
// own recipient list without duplicating the fetch call notify() already has.
// No-ops (returns false) when RESEND_API_KEY is unset — same philosophy as
// slackAlert: adding the key turns email on with no code change.
export async function sendResendEmail(opts: { subject: string; text: string; to: string; from?: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const from = opts.from ?? process.env.ALERT_EMAIL_FROM ?? "Growth OS <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: opts.to.split(",").map((t) => t.trim()).filter(Boolean),
        subject: opts.subject,
        text: opts.text,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function notify(n: Notification): Promise<{ slack: boolean; email: boolean }> {
  const out = { slack: false, email: false };

  // Both are attempted independently: a broken email provider must not swallow
  // a Slack alert that would otherwise have reached someone.
  try {
    await slackAlert(`*${n.subject}*\n${n.body}`);
    out.slack = true;
  } catch {
    // slackAlert already no-ops when unconfigured; a throw here is a real failure
    // and still must not stop the email.
  }

  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.ALERT_EMAIL_FROM ?? "Growth OS <onboarding@resend.dev>";

  if (key && to) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: to.split(",").map((t) => t.trim()).filter(Boolean),
          subject: n.subject,
          text: n.body,
        }),
      });
      out.email = res.ok;
    } catch {
      out.email = false;
    }
  }

  return out;
}
