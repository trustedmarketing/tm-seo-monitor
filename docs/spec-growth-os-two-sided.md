# SPEC — Growth OS SaaS: Two-Sided Dashboard
**To:** TM CTO + COO (joint) · **From:** Tom · **Status:** standing specification — implemented by WO-003
**Supersedes nothing.** Extends docs/tm-growth-os-plan.md — this defines the *product surface* that plan's modules sit behind.

> **Renumbering note (2026-07-27).** This document was written as "WO-002" but
> that number was already taken by `docs/wo-002-dashboard-reorg.md`, which was
> approved, built, and shipped to production on 2026-07-23 (PR #13) — its number
> is fixed in git history and WORKLOG entries.
>
> This document is not a work order: it is self-described as "spec for review,
> not yet scheduled" and it defines a product surface rather than a scheduled
> unit of work. It has therefore been renamed out of the WO sequence and kept as
> a **standing spec**. The work order that implements it is
> **`docs/wo-003-design-implementation.md`**. Content below is unchanged.

---

---

## 1. Product goal in one sentence

A two-sided platform where **the agency team approves work with a yes/no**, the system does the staging, execution, and QC in the background, and **the client sees their whole growth program** — organic, paid, social, GBP, AEO, automation — plus the monthly playbook and whether we're hitting it.

Two audiences, one data spine:

| | Agency side | Client side |
|---|---|---|
| Who | TM pods, specialists, leads | Client stakeholders |
| Primary job | Decide + execute | Understand + approve their own asks |
| Core surface | Approval queue, QC, campaign controls | Playbook, progress, results |
| Tone | Dense, operational | Clear, narrative, no jargon |

---

## 2. The atomic unit: the Approval Card

Everything in this product reduces to one repeated component. If the team has to learn more than this, the design failed.

```
┌──────────────────────────────────────────────────────────────┐
│ [HIGH] SEO · Homepage title tag                    Salty Dog │
│                                                              │
│ Change the H1 from "Welcome to Salty Dog" to                 │
│ "Boat Salt Remover & Marine Cleaning Products"               │
│                                                              │
│ Why: targets "salt remover for boats" (1.2K/mo), currently   │
│ ranking #12. Est. impact: page-one within 4–6 weeks.         │
│                                                              │
│ ┌ BEFORE ─────────────┐  ┌ AFTER ──────────────┐            │
│ │  [live screenshot]  │  │ [staged screenshot] │            │
│ └─────────────────────┘  └─────────────────────┘            │
│                                                              │
│ Staged on: staging.getsaltydog.com  ·  QC: 6/6 checks passed │
│                                                              │
│        [ ✓ Approve & publish ]   [ ✗ Decline ]   [ Edit ]    │
└──────────────────────────────────────────────────────────────┘
```

Non-negotiable properties:
- **The work is already done before the human sees it.** Staged, screenshotted, QC-passed. Approve = publish, not "start building."
- **Before/after is visual, not described.** Screenshots for site changes, creative previews for ads, rendered post for social.
- **One sentence of why, one line of expected impact.** No SEO jargon on the client side.
- **Decline requires a reason** (dropdown: wrong direction / bad timing / client said no / other) — decline reasons feed the learning layer.
- **Edit opens the change, not a ticket.** Small text edits happen inline; anything structural bounces back to the pod.
- **Every card has an owner and an age.** Cards older than the SLA surface in the lead's queue automatically.

The same card renders in three contexts: agency approval queue, client approval queue (for changes needing client sign-off), and read-only in the change history.

---

## 3. Information architecture

### Agency side (`/agency`)
```
Portfolio          → all clients, health strip, what needs attention today
Approvals          → the queue. Filterable by client / type / severity / age
  ├ Site changes   (staged, QC'd, awaiting publish)
  ├ Ad actions     (pause / launch / budget)
  ├ Creative       (Bloom-generated, awaiting sign-off)
  └ Content        (blog drafts, social posts)
Client workspace   → per client: everything below, plus internals
  ├ Overview · Organic · Paid · Social · GBP · AEO · Automation
  ├ Playbook       (this month's plan + progress)
  ├ QC             (latest site scan, issues, history)
  ├ Change log     (what shipped, verdicts, 28-day measurement)
  └ Settings       (integrations, tokens, cadences, entitlements)
Research           → audit / competitors / keywords (built)
Ops                → collector health, token expiry, job queue, alerts
```

### Client side (`/portal`)
```
Home               → "here's where you stand" — 4 headline numbers + this month's focus
Playbook           → what we're doing this month, why, and progress bars
Organic            → rankings that matter, blog concepts awaiting your input, published work
Paid               → spend, results, live creative gallery, what we're testing
Social             → what posted, what performed, what's queued
Google Business    → calls, direction requests, reviews (+ response status)
AEO                → "when people ask AI about you" — prompt table, cited/mentioned/absent
Automation         → what's running for you (lead routing, review requests, follow-ups)
Approvals          → things waiting on you (blog topics, creative, big changes)
Results            → the change log in client language: what we shipped, what it did
```

**Client side design rules:** no metric appears without a plain-English explanation on hover; no negative number appears without context; nothing is shown that the account manager hasn't cleared (accuracy gate). Default view answers "are we winning?" in under five seconds.

---

## 4. Client-facing modules — what each contains

**Organic.** Ranking movement for *conversion-relevant* keywords only (vanity terms hidden). Blog post concepts as cards: title, angle, target keyword, why it matters — client hits approve/decline/comment. Approved concepts flow to drafting; drafts come back as approval cards with rendered preview + generated hero image (Bloom). Published pieces show with performance after 28 days.

**Paid (Meta, LinkedIn, Google).** Spend, conversions, ROAS/CPL per platform, trended. Live creative gallery — every running ad with its performance, so the client sees what's actually in market. "What we're testing" section for active experiments. Creative awaiting client approval appears as cards.

**Social.** Published post grid with engagement, top performers surfaced, upcoming queue (from PostFlow), and the analysis: what formats/hooks work for this account.

**Google Business Profile.** Calls, direction requests, profile views, search queries triggering the listing, review rating + velocity, and unanswered reviews flagged with drafted responses awaiting approval.

**AEO.** The prompt table in client language: "When someone asks ChatGPT *'best salt remover for boats'*, you are **cited / mentioned / not showing**." Trend over time. This is the section clients find most novel — lead with it in QBRs.

**Automation.** Plain-language list of what runs for them: review requests, lead routing, follow-up sequences, reporting. Status + volume ("312 review requests sent, 47 reviews collected"). Demystifies the retainer.

**Playbook.** The month's plan as a checklist with owner and status, generated from the tier entitlement + the recommendation queue, so it's real work rather than a marketing artifact. Progress bar per workstream. Last month's playbook archived with outcomes.

---

## 5. Execution pipeline behind the yes/no

This is what makes "approve" trivial for the human and safe for the client.

```
Recommendation
   ↓ (agent builds it — no human yet)
Staged change  →  screenshot before/after  →  automated QC  →  Approval card
   ↓ (human: one click)
Publish  →  change ledger entry  →  28-day measurement  →  verdict
```

**Per platform:**

| Target | Staging mechanism | Publish action | Rollback |
|---|---|---|---|
| WordPress (WP Engine) | WP Engine staging env; change applied there via WP REST / git | Push staging→production, or publish pending revision | WP revision restore / re-deploy previous |
| Git sites (Next.js) | Branch + Vercel preview deploy | Merge PR | Revert commit |
| Shopify | Theme branch preview / draft product | Publish theme or product | Previous theme version |
| Meta / Google / LinkedIn ads | Entity created **paused** | Set status ACTIVE | Pause / delete |
| Social | Draft in PostFlow | Schedule/publish | Delete or unschedule |
| Creative (Bloom) | Generated asset in library | Attach to ad + launch | Swap creative |

**⚠️ CTO correction — LocalWP is the wrong tool for this.** Local WP runs on an individual machine and is not reachable from a cloud dashboard; a change staged there is invisible to everyone else and dies with the laptop. Correct path: **WP Engine staging environments** (already in use for Masterpiece) as the staging target, with the WP REST API + application passwords for content/meta changes and git-push deploys for theme-level work. Local WP stays what it should be — a developer's sandbox, not part of the production pipeline. This changes nothing about the user experience; it changes where "staged" lives so the whole team and the client can see it.

---

## 6. Site QC engine (daily / biweekly)

Runs per client on a configurable cadence (Dominate: daily; Momentum: biweekly; Consistency: monthly).

**Checks:** uptime + response time · broken internal/external links · missing or duplicate title/meta/H1 · missing alt text · schema validity · Core Web Vitals · HTTPS/mixed content · robots/sitemap/llms.txt integrity · 404 spike detection · unexpected noindex (the classic disaster) · form submission test · GBP hours/NAP consistency.

**Behavior:** issues become recommendation cards with severity. Critical issues (site down, noindex on money pages, forms broken) bypass the queue and fire an immediate Slack alert. A QC panel per client shows current score, open issues, and history — this is also the artifact that justifies the retainer during renewal conversations.

---

## 7. Paid ads control surface

From the dashboard, agency-side, per platform:

**Low-risk (single approval):** pause/resume campaign, adset, or ad · adjust budget within a preset band (±25%) · pause an underperforming creative.

**Higher-risk (lead approval + confirmation modal showing spend exposure):** launch a new campaign · raise budget beyond band · change bid strategy or targeting · launch new creative.

**Hard guardrails (CTO requirement):** every write action passes through a spend-guard layer — per-client daily and monthly spend ceilings stored in the DB; any action that could exceed them is blocked and escalated, not approved-through. Every action writes to an audit log (who, what, when, before/after values). No agent ever performs a paid write autonomously in v1 — agents propose, humans approve, the system executes.

**Creative loop with Bloom:** fatigue detected (frequency ↑, CTR ↓) → Bloom generates on-brand variants from the client's brand session → variants appear as approval cards with preview → approved variants upload **paused** to the ad account → human sets live → launch date lands in the change ledger → measured like any other change.

---

## 8. COO review — operational requirements

**Approval quality gates the whole product.** A yes/no UI is only as good as what's behind the button; if 30% of cards are junk, the team learns to click no (or worse, yes) reflexively. Requirement: recommendations must earn their way into the queue — new rule types start in a *shadow* state visible only to the pod lead until they demonstrate a decent approval rate, then graduate to the main queue.

**Who can approve what.** Role matrix required before build:
- *Specialist:* content edits, meta/title changes, social posts, creative variants, ad pause
- *Pod lead:* structural site changes, new pages, campaign launches, budget increases, anything client-facing
- *Client:* their own brand/messaging decisions, blog topics, creative sign-off, anything the retainer says needs their approval
Everything else is invisible to the client, which is the point — they shouldn't see 40 technical cards a week.

**Client-visible task tracking cuts both ways.** If the playbook shows progress, it also shows when we're behind. That's good discipline and a retention risk on a bad month. Requirement: playbook items get realistic due dates set by the pod (not auto-generated), and slipping items show a status + note, never a silent red bar. The COO's position: this transparency is a selling advantage *if* the operation is honest and current, and a liability if the platform outruns the pods' actual capacity.

**Capacity reality.** 13 clients × daily QC + approval queue + playbook upkeep is a real time cost. Budget ~20–30 min/client/week of pod time for queue triage, and instrument it: if approval queues consistently exceed SLA, the answer is fewer/better recommendations, not more clicking.

**Client onboarding to the portal** needs its own runbook (accounts, expectations, a 20-minute walkthrough call, what they approve vs what we handle). Portal access is a Dominate/Momentum feature; Consistency gets read-only results.

---

## 9. CTO review — technical requirements

**Blocking prerequisite: Supabase Auth + per-client RLS.** Client login moves this from "nice to have in Phase C" to **the gate that must clear before any portal work ships**. Per-user accounts, per-client row-level policies, agency users see all clients, client users see exactly one. ~1 week, touches every query. Nothing client-facing merges before it.

**Multi-tenancy from the start.** "SaaS" implies this may eventually run for someone other than TM. Design the schema and auth as `organization → clients → users` now (even with one org), so a future white-label doesn't require a migration of everything.

**Audit log, non-optional.** Every approve/decline/publish/pause writes an immutable row: actor, action, target, before/after, timestamp, IP. This is what makes automated site and ad changes defensible if a client ever disputes one.

**Screenshot service.** Before/after visuals need a headless browser (Playwright on a scheduled job or a service like Browserless/ScreenshotOne). Not free, not hard, but it's an infra dependency the plan didn't have — spec it in Phase A.5.

**Rollback is a feature, not a hope.** Every executed change type ships with a tested revert path (table §5) before that change type is allowed in production. Untested rollback = change type stays in staging-only mode.

**Bloom integration** (pending the WO-002 evaluation): brand session ID per client stored on the clients table; generated assets mirrored into our own `creatives` table with the source URL, so vendor loss costs us the generator, not the asset history.

**Idempotency + rate limits** on every write adapter: approving twice must not publish twice or launch two campaigns. Every action carries a client-generated key.

**Realtime for the queue.** Supabase Realtime on the approvals table so two people never work the same card — cheap to add, prevents a genuinely annoying failure mode.

---

## 10. Build sequence for this spec

Slots into the existing plan rather than replacing it:

1. **Now (Phase A.5):** Supabase Auth + RLS + multi-tenant schema · audit log · screenshot service · approvals table + realtime
2. **Next:** the Approval Card component + agency approval queue (site changes only, WP Engine staging path) — one client, one change type, end to end
3. **Then:** QC engine + client QC panel · paid pause/resume controls with spend guards
4. **Then:** client portal v1 (Home, Playbook, Organic, Results) for one pilot client
5. **Then:** remaining portal modules (Paid, Social, GBP, AEO, Automation) as their data modules land per the main plan
6. **Then:** campaign creation + Bloom creative loop (highest risk, last)

**Pilot discipline:** every step above proves out on one client before touching a second. The first client-facing portal login should be a Dominate client who will tell you the truth.

---

## 11. Open decisions
- [ ] Which client pilots the portal (needs: Dominate tier, candid, WP Engine or git site)
- [ ] Portal as a tier entitlement — Dominate + Momentum only? (ties to the pricing decision already open)
- [ ] Domain: portal.trustedmarketing.com vs a path inside growth.trustedmarketing.com
- [ ] Do clients get individual logins or one shared per account (individual = better audit, more support burden)
- [ ] SaaS ambition: is this ever sold to other agencies? Answer changes multi-tenancy urgency and roadmap priorities
- [ ] Bloom adopt/pass (WO-002 evaluation in flight)
