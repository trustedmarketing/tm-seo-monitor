# CLAUDE.md — TM Growth OS (tm-seo-monitor)

## What this is
Trusted Marketing's client growth platform, live at seo.trustedmarketing.com.
Next.js 14 (App Router) on Vercel · Supabase (service-role, RLS locked) · DataForSEO + Google Search Console + GA4 · TM design system (Instrument Serif + Inter, tokens in src/styles/tm-tokens.css).

Read before building anything:
- docs/tm-growth-os-plan.md — the full platform plan (modules, schema, phases)
- docs/wo-001-parallel-build-enabling-layer.md — build conventions and current wave

## Current state (do not rebuild)
Daily collector cron (SEO, AI prompts, crawls) · recommendations engine with lifecycle · change ledger with 28-day before/after measurement · GSC history + backfill · client detail pages with ranges · research tools · viewer/admin auth (signed cookie middleware) · admin panel for clients/keywords/prompts.

## Conventions (from WO-001 — binding)
- One agent = one module = one branch (`module/<name>`) = one worktree. Never touch another module's files.
- Migrations are serialized: propose a numbered file in supabase/, get it merged before dependent code. Never edit an applied migration.
- Every module ships with: collector, vitest tests + fixtures (MOCK_APIS=1 path), collector_runs integration, README section, and its recommendation rules if applicable.
- All DB reads in pages/routes go through src/lib/db.ts (no-store) — Vercel caches raw fetches otherwise.
- Preview deploys use staging Supabase (Preview-scoped env vars). Production data is never touched from a branch.
- UI uses TM tokens only; serif display numerals for metrics; no new fonts or colors.
- Env vars: document any new one in README before merging. Values live in Vercel/GitHub secrets or Supabase Vault — never in code, never in the DB in plaintext.

## Definition of done for a PR
Green build · tests pass · preview URL renders against staging · collector_runs shows a clean run · README/docs updated · no unexplained env or schema changes. PRs meeting this enter Tom's daily merge review; don't merge to main yourself unless the change class is on the auto-merge list below.

## Autonomy & escalation (CTO policy)
Proceed WITHOUT asking Tom:
- All work on module branches and staging: code, tests, schema proposals, refactors, docs
- Spawning/coordinating sub-agents per the WO-001 stream map
- Auto-merge list (only after the enabling layer is proven): docs, tests, fixtures, README, non-schema refactors with green CI

REQUIRE Tom (batch into the daily digest, don't block other streams):
- Merges to main that change schema, auth, cron behavior, or anything client-visible
- Any new recurring cost, paid API tier, or spend > $25/mo
- Anything requiring account-level access (Vercel/Supabase/Google/Meta account actions, new tokens)

ESCALATE IMMEDIATELY (Slack/message, not the digest):
- Anything touching a live client property or client-facing data accuracy
- Suspected credential exposure or security issue
- Production down or data-loss risk
- A blocker stalling 2+ streams for more than a day

## Communication protocol
- Append a dated entry to docs/WORKLOG.md at the end of every working session: shipped / in progress / blocked / decisions needed. Tom reads WORKLOG + open PRs once daily; that is the update channel. No status pings outside it except the escalation list above.
- Decisions needed from Tom are written as yes/no questions with a recommended answer.

## Client isolation
Client-specific work follows the exec-team plugin's client-isolation rules: one client per task, only that client's folder/context, verify account identifiers before any external write, log completed work per client.
