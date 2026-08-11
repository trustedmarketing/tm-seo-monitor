-- 046_client_slack_webhook.sql — per-client Slack destination for the daily
-- brief (module/daily-brief). Nullable: a client with none simply gets no
-- Slack post, matching the no-op-when-unconfigured pattern already used for
-- the portfolio-wide SLACK_WEBHOOK_URL ops alerts.
alter table clients add column if not exists slack_webhook_url text;
