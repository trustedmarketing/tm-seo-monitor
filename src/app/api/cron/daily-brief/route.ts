// app/api/cron/daily-brief/route.ts — module/daily-brief.
//
// Runs daily via Vercel cron, ~30 min after /api/cron/collect (see vercel.json)
// so that day's SEO/AEO/paid data is already written before the brief reads
// it. One consolidated email per run (all clients, one recipient) plus, for
// any client with a slack_webhook_url configured, a per-client Slack post of
// that client's wins/losses/opportunities.
import { createClient } from "@supabase/supabase-js";
import { buildClientBrief, formatBriefEmail, formatBriefSlack, type ClientBrief } from "@/lib/dailyBrief";
import { sendResendEmail } from "@/lib/notify";
import { slackAlertTo } from "@/lib/slack";
import { recordRun } from "@/lib/collectorRuns";

export const maxDuration = 120;

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const t0 = Date.now();
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: clients, error } = await db
    .from("clients")
    .select("id, name, domain, slack_webhook_url")
    .eq("active", true);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const briefs: ClientBrief[] = [];
  for (const c of clients ?? []) {
    try {
      briefs.push(await buildClientBrief(db, c));
    } catch (e) {
      await recordRun(db, "daily_brief", c.id, {
        status: "error",
        error: (e as Error).message,
        duration_ms: Date.now() - t0,
      });
    }
  }

  const dateLabel = new Date().toISOString().slice(0, 10);
  const { subject, text } = formatBriefEmail(briefs, dateLabel);
  const to = process.env.BRIEF_EMAIL_TO ?? "thomas@trustedmarketing.com";
  const emailSent = await sendResendEmail({ subject, text, to });

  // Independent per client: one revoked/bad webhook must not block the others.
  const slackTargets = briefs.filter((b): b is ClientBrief & { slackWebhookUrl: string } => !!b.slackWebhookUrl);
  const slackResults = await Promise.all(
    slackTargets.map((b) => slackAlertTo(b.slackWebhookUrl, formatBriefSlack(b)))
  );

  await recordRun(db, "daily_brief", null, {
    status: emailSent ? "success" : "error",
    detail: `clients=${briefs.length} email_to=${to} slack_posts=${slackResults.filter(Boolean).length}/${slackTargets.length}`,
    error: emailSent ? undefined : "email not sent — RESEND_API_KEY unset or send failed",
    duration_ms: Date.now() - t0,
  });

  return Response.json({
    ran_at: new Date().toISOString(),
    clients: briefs.length,
    email_sent: emailSent,
    email_to: to,
    slack_posts: slackResults.filter(Boolean).length,
    slack_targets: slackTargets.length,
  });
}
