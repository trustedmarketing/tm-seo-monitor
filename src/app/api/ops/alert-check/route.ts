// api/ops/alert-check — is the alerting actually wired, and does a message
// really arrive?
//
// The accuracy alerts (lib/accuracyAlerts.ts) only fire when something is
// wrong, which means the first time anyone finds out the channel was
// misconfigured is the moment they needed it and it stayed silent. An alert
// system nobody has ever seen fire is not a verified alert system — same
// reasoning as the accuracy gate in CLAUDE.md, applied to the alerting itself.
//
// GET            reports which channels are configured. Sends nothing.
// GET ?send=1    actually delivers a test alert, so "configured" becomes
//                "I watched it arrive". Opt-in because it posts to a real
//                Slack channel and a real inbox.
//
// Owner-only. Reports only whether each secret is PRESENT, never its value.
import { getProfile } from "@/lib/supabaseServer";
import { notify } from "@/lib/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }

  const slackConfigured = !!process.env.SLACK_WEBHOOK_URL;
  // notify() gates email on BOTH — a Resend key with no recipient sends nothing,
  // silently. That asymmetry is the likeliest way this ends up half-configured.
  const resendKeyPresent = !!process.env.RESEND_API_KEY;
  const emailToPresent = !!process.env.ALERT_EMAIL_TO;
  const emailConfigured = resendKeyPresent && emailToPresent;

  const config = {
    slack_configured: slackConfigured,
    resend_key_present: resendKeyPresent,
    alert_email_to_present: emailToPresent,
    email_configured: emailConfigured,
    email_from: process.env.ALERT_EMAIL_FROM ?? "Growth OS <onboarding@resend.dev> (default)",
  };

  if (!slackConfigured && !emailConfigured) {
    return Response.json({
      ok: false,
      failed_at: "no_channel_configured",
      hint:
        "Set SLACK_WEBHOOK_URL, or both RESEND_API_KEY and ALERT_EMAIL_TO, in Vercel " +
        "→ Settings → Environment Variables, then redeploy. Until then every alert is a silent console log.",
      ...config,
    });
  }

  if (new URL(req.url).searchParams.get("send") !== "1") {
    return Response.json({
      ok: true,
      sent: false,
      hint: "Add ?send=1 to actually deliver a test alert and confirm it arrives.",
      ...config,
    });
  }

  const result = await notify({
    subject: "Growth OS: test alert",
    body:
      "This is a test of the Growth OS alerting channel, triggered manually from " +
      "/api/ops/alert-check?send=1.\n\n" +
      "If you are reading this, revenue-mismatch and stale-data alerts will reach you here.\n\n" +
      "Nothing is wrong. No action needed.",
  });

  return Response.json({
    ok: true,
    sent: true,
    // notify() reports slack:true even when SLACK_WEBHOOK_URL is unset, because
    // slackAlert() no-ops rather than throwing. Report what was actually
    // CONFIGURED alongside it so this endpoint can't hand back a false positive.
    delivered: { slack: result.slack && slackConfigured, email: result.email },
    // Resend's own rejection reason when the email leg failed — usually an
    // unverified sender domain, or test-mode's "you can only send to the
    // address you signed up with".
    email_error: result.emailError ?? null,
    ...config,
    hint: result.email
      ? "Email accepted by Resend. If it still hasn't arrived, check spam and Resend's dashboard for a bounce."
      : emailConfigured
        ? "Email was NOT accepted — see email_error."
        : "No email channel configured — see resend_key_present / alert_email_to_present.",
  });
}
