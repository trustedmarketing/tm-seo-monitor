-- 007_clickup_sync.sql — Stream 5: ClickUp sync (recs → tasks → shipped).
-- Additive only. Run after 004 (or later, whatever lands last in the serialized
-- queue) — no dependency on 005/006 content, just column additions to existing
-- tables. Do NOT apply — the CTO serializes/applies migrations (WO-001 §4).

-- Per-client ClickUp list a synced task should land in (Salty Dog space, etc).
alter table clients add column if not exists clickup_list_id text;

-- Per-recommendation ClickUp task linkage, set once a rec is synced.
alter table recommendations add column if not exists clickup_task_id text;
alter table recommendations add column if not exists clickup_task_url text;
alter table recommendations add column if not exists clickup_synced_at timestamptz;
