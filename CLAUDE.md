# Growth OS Monitor · Agent Operating Brief

> **This is the standing brief for `tm-seo-monitor`. Read it at the start of
> every session.** Derived from `docs/tm-growth-os-plan.md` §8 (Governance &
> guardrails) + WO-001 §4 (Branch/agent conventions), per CTO decision
> 2026-07-21; promoted from `docs/CLAUDE-monitor-draft.md` to root on
> 2026-07-27. The WordPress-theme brief that previously occupied this path
> belonged to a different project and is archived at
> `docs/archive/CLAUDE-wordpress-theme.md` — it does not apply here.

---

## Where things live (read these first)

| File | Location | What it's for |
|---|---|---|
| `STATUS.md` | **repo root** | Current state — shipped / in flight / blocked / pending Tom |
| `WORKLOG.md` | **repo root** | Session log, newest on top. The async status feed |
| `CLAUDE.md` | **repo root** | This file |
| Plan | `docs/tm-growth-os-plan.md` | The platform plan — modules, phases, APIs |
| Product spec | `docs/spec-growth-os-two-sided.md` | Agency + client portal product surface |
| Work orders | `docs/wo-00N-*.md` | Scheduled units of work, numbered in sequence |
| Design source | `docs/design/README.md` | Map of the UI export — start there, not the HTML |
| Client onboarding | `docs/sop-client-onboarding.md` | SOP for adding a client, in dependency order |

`STATUS.md` and `WORKLOG.md` are at the **repo root, not in `docs/`**. Nothing
should reference them at any other path.

---

## Project identity

`tm-seo-monitor` — the Trusted Marketing Growth OS platform. Next.js 14 (App
Router) + Supabase (Postgres) + Vercel. One login showing the full performance
picture per client and closing the loop:

**Observe → Diagnose → Recommend → Execute → Measure → Learn**

Shipped today: daily SEO collector (Vercel cron → DataForSEO + GSC),
recommendations engine with lifecycle, change ledger with automatic 28-day
before/after measurement. The roadmap extends the same loop to paid, creative,
and social. Do **not** rebuild what §1 of the plan lists as existing.

- Repo: `trustedmarketing/tm-seo-monitor`
- Production Supabase: project `xelweikfciqakagkerat`
- Staging Supabase: `tm-growth-staging` (WO-001 §1)
- Vercel project: `trusted-marketing-seo`

---

## Autonomy ladder (plan §8)

Every module and agent operates under these, in force:

1. **Human-approved in v1.** Everything ships behind human approval. Auto-merge
   is earned only by change classes with a *validated* track record (meta titles,
   alt text, schema, llms.txt graduate first). Ad launches are **always**
   human-approved — no exceptions.
2. **Staging first, dry-run always.** Every execution adapter (git, WP, Shopify)
   ships with a dry-run mode and is rehearsed against staging before touching a
   live client property. No exceptions in the execution phase.
3. **Accuracy gate.** No module becomes client-visible until it has run two full
   collection cycles parallel-checked against the platform's own UI. Measurement
   verdicts stay internal until the account manager approves surfacing them.
4. **RLS hard gate.** Supabase Auth + per-client RLS policies must land before any
   client receives a login. Cannot be retrofitted after client access exists.
5. **Secrets never surface.** Every platform token lives in the Supabase Vault,
   referenced by `auth_ref`. Nothing client-facing ever sees a token.
6. **Honest reporting.** Inconclusive verdicts stay inconclusive. Algorithm-update
   and paid-overlap flags surface on client-facing views. A shipped change that
   *declined* performance escalates same-day — declines are the system working.

---

## Escalation list — the ONLY reasons to ping Tom

Operate autonomously otherwise; use `WORKLOG.md` for status. Ping only for:

- **External-account tasks agents can't do:** token generation, API access
  applications (Google Ads dev token, GBP API), Supabase/Vercel/GitHub account
  provisioning, ClickUp workspace choice, OAuth the agent can't self-serve.
- **Missing or ambiguous artifacts:** credentials not provided, migrations/schema
  absent, a governing decision the plan doesn't cover.
- **Schema-spine changes:** new migrations are serialized; Tom merges them in
  order before dependent module work starts (WO-001 §4).
- **Anything that would touch a live client property** outside an approved,
  rehearsed, dry-run-tested path.
- **A verdict/measurement that a shipped change declined performance** (same-day).

Do **not** ping for: routine in-repo build work, test writing, module branches,
preview deploys against staging, WORKLOG updates.

---

## Branch / agent conventions (WO-001 §4)

- **One agent = one module = one branch = one worktree.** No agent touches
  another module's files. Branch naming: `module/<slug>` (e.g. `module/meta-collector`).
- **Schema is the shared spine.** Migrations are serialized. Agents *propose*
  migration files; the CTO merges them in order before dependent work starts.
  Every new migration lands in **staging first**.
- **Every module ships with:** collector, tests + fixtures, `collector_runs`
  integration, a README section, and its recommendations rules where applicable.
- **Definition of done for a module PR:** preview URL renders, collector runs
  green against staging, tests pass, CI green → then it enters Tom's daily merge
  review. One batched merge session per day; `main` auto-deploys to production.

---

## Test & CI discipline (WO-001 §3)

- **vitest.** Per-collector pattern: recorded/mocked platform responses in
  `tests/fixtures/`, assert correct rows written to a test schema, assert failure
  paths write `collector_runs` errors instead of throwing.
- **`MOCK_APIS=1`** makes every collector read fixtures instead of live APIs —
  used by tests and by staging when burning real API credits is pointless.
- **CI:** GitHub Action runs build + tests on every PR. Red CI blocks merge.

---

## Update channel

`WORKLOG.md` at repo root — newest on top. Every session logs: what was verified,
what shipped, blockers, and next action. This is Tom's async status feed; it
replaces pinging him for anything not on the escalation list.
