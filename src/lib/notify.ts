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

  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.ALERT_EMAIL_FROM ?? "Growth OS <onboarding@resend.dev>";

  if (!key || !to) {
    // Both are required. Saying WHICH one is missing matters: a Resend key with
    // no recipient looks configured and sends nothing.
    out.emailError = !key && !to
      ? "RESEND_API_KEY and ALERT_EMAIL_TO both unset"
      : !key
        ? "RESEND_API_KEY unset"
        : "ALERT_EMAIL_TO unset";
    return out;
  }

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
    if (!res.ok) {
      // Resend's rejection reason is the whole diagnosis — "domain not verified",
      // "you can only send to your own address in test mode", "invalid API key".
      // Swallowing it into a bare false left no way to tell those apart.
      const body = await res.text().catch(() => "");
      out.emailError = `Resend HTTP ${res.status}: ${body.slice(0, 300)}`;
    }
  } catch (e) {
    out.email = false;
    out.emailError = `fetch failed: ${(e as Error).message}`;
  }

  return out;
}
