// api/ops/alert-check — is the alerting actually wired, and does a message
// really arrive?
//
// The accuracy alerts (lib/accuracyAlerts.ts) only fire when something is
// wrong, which means the first time anyone finds out the channel was
// misconfigured is the moment they needed it and it stayed silent. An alert
// system nobody has ever seen fire is not a verified alert system — same
// reasoning as the accuracy gate in CLAUDE.md, applied to the alerting itself.
//
// GET                   reports which channels are configured. Sends nothing.
// GET ?send=1           actually delivers a test alert, so "configured" becomes
//                       "I watched it arrive". Opt-in because it posts to a
//                       real Slack channel and a real inbox.
// GET ?ping_heartbeat=1 pings HEARTBEAT_URL to prove it resolves. Separate
//                       from ?send=1 because a ping is a real check-in that
//                       resets the external service's late-cron timer.
//
// Owner-only. Reports only whether each secret is PRESENT, never its value.
import { getProfile } from "@/lib/supabaseServer";
import { notify } from "@/lib/notify";
import { pingHeartbeat } from "@/lib/heartbeat";

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

  const customFrom = !!process.env.ALERT_EMAIL_FROM;
  const config = {
    slack_configured: slackConfigured,
    resend_key_present: resendKeyPresent,
    alert_email_to_present: emailToPresent,
    email_configured: emailConfigured,
    // The dead-man's switch. Otherwise the only proof it's armed is waiting for
    // the next daily cron — and a typo'd URL wouldn't show up until the external
    // service started reporting missed check-ins.
    heartbeat_configured: !!process.env.HEARTBEAT_URL,
    email_from: process.env.ALERT_EMAIL_FROM ?? "Growth OS <onboarding@resend.dev> (default)",
    // The default sender is technically valid, which is exactly why it bites:
    // Resend only lets onboarding@resend.dev deliver to the account owner's own
    // address, so it works in a first test and fails for every other recipient.
    email_from_warning: customFrom
      ? null
      : "ALERT_EMAIL_FROM is unset. Resend only allows the default onboarding@resend.dev sender to deliver to the Resend account owner's own address — set ALERT_EMAIL_FROM to an address on a domain verified in Resend.",
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

  const params = new URL(req.url).searchParams;

  // ?ping_heartbeat=1 proves HEARTBEAT_URL actually resolves, rather than
  // waiting for the next daily cron to find out it was typo'd. Separate from
  // ?send=1 on purpose: a ping counts as a real check-in with the external
  // service and resets its "cron is late" timer, so it should never be a
  // side effect of testing the Slack/email channels.
  if (params.get("ping_heartbeat") === "1") {
    const hb = await pingHeartbeat();
    return Response.json({
      ok: hb.ok,
      pinged_heartbeat: true,
      heartbeat: hb.configured ? (hb.ok ? "ok" : `failed: ${hb.error}`) : "not configured",
      ...config,
      hint: hb.ok
        ? "Ping accepted — the check should now show a recent check-in in the external dashboard. Note this reset its late-cron timer."
        : hb.configured
          ? "HEARTBEAT_URL is set but the ping failed — check the URL is exactly the one the provider gave you."
          : "HEARTBEAT_URL is unset, so a cron that stops running would be silent. Set it in Vercel and redeploy.",
    });
  }

  if (params.get("send") !== "1") {
    return Response.json({
      ok: true,
      sent: false,
      hint:
        "Add ?send=1 to deliver a test alert and confirm it arrives, " +
        "or ?ping_heartbeat=1 to confirm HEARTBEAT_URL resolves.",
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
