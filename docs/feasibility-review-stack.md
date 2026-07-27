# Feasibility Review — Growth OS Dashboard vs. Current Stack
**Reviewers:** CTO (build) + COO (delivery) · **Subject:** Growth OS.dc.html, ApprovalCard, RecCard
**Question asked:** what in this design is actually possible with what we have?

**Headline:** roughly 60% builds on what's already running. 25% needs new-but-ordinary work. **15% is blocked on approvals and data sources we don't have yet — and three of those blockers have never been started.** Nothing in the design is impossible; several things are further away than the mockup implies.

---

## CTO — feature-by-feature

### Build now, no new dependencies
| Design element | Why it's clear |
|---|---|
| Recommendation queue, approve/decline, 60-day suppression | Recommendations engine + lifecycle already shipped |
| Change log / receipts / "decided by" | `changes` table exists; add actor column |
| 28-day measurement + verdicts | Shipped and tested |
| Organic tab (rankings, deltas, trend) | DataForSEO + GSC live |
| AEO prompt table | Shipped (ChatGPT) — see caveat below |
| QC panel, site score, issue list, scan history | DataForSEO On-Page API, already integrated |
| Settings: guardrails, approval matrix, muted rules | Config in Supabase; pure UI work |
| Slack alerts on failures/SLA | Webhook, trivial |
| Empty/loading/skeleton states | Front-end only |

### Needs new but ordinary work
| Element | What it takes | Est. |
|---|---|---|
| **Before/after screenshots** | New infra — Playwright on a job runner, or Browserless/ScreenshotOne. Not in stack today. | 2–3 days + small monthly cost |
| **Client portal (all of it)** | **Hard gate: Supabase Auth + per-client RLS.** Touches every query. Nothing client-facing ships first. | ~1 week |
| **WP staging → publish flow** | WP Engine staging + WP REST API (application passwords) per site | 3–4 days for the adapter |
| **Git-site PR flow** | Claude Code GitHub Action, already proven pattern | 2–3 days |
| **ClickUp sync** (approved rec → task → shipped) | ClickUp API is solid | 2 days |
| **Meta ads read + pause/budget** | Marketing API via system-user token — **token not yet generated (Tom)** | 3–4 days after token |
| **Bloom creative generation** | MCP + REST available; pending the adopt/pass evaluation | 2–3 days if adopted |
| **Failed-job state, undo/revert windows, role-locked cards** | Punch-list items — design + logic, no new vendors | 2 days |

### Blocked — and the clock hasn't started
| Element | Blocker | Reality |
|---|---|---|
| **Google Ads data + controls** | Developer token application via MCC | Days-to-weeks approval. **Not yet submitted.** The Paid tab's Google rows cannot be live until this clears. |
| **GBP tab entirely** (calls, directions, views, review replies) | Business Profile Performance API access application | Weeks. **Not yet submitted.** The design's GBP module and "approve all three replies" are dark until then. |
| **LinkedIn ads + organic** | LinkedIn Marketing / Community Management API app review | Weeks, and **not started at all** — the design shows a LinkedIn commercial-contract test as if it's live data. |
| **PostFlow drafting handoff** | Unknown whether PostFlow exposes an API | **Open question since the original plan.** If there's no API, "drafts land in PostFlow" becomes manual paste — or we replace PostFlow. Answer this before Social ships. |

### Verify before promising
- **Multi-model AEO.** The design says prompts are checked against "ChatGPT, Gemini and Google AI Overviews." We currently check ChatGPT only. Confirm DataForSEO's AI Optimization coverage for the other two before that copy goes client-facing — it's a claim on a client screen.
- **Undo semantics per platform.** WP revisions, Vercel revert, Meta pause, Shopify theme rollback all behave differently. Each needs its own tested path before that change type is allowed to ship (see punch list #1).
- **"Run scan now"** triggers a paid crawl. Rate-limit per client per day.

---

## COO — the delivery gaps the design assumes away

**1. We don't have the data spine for the portal's best numbers.**
The client portal leads with *Calls 184 · Cost per job $133 · Jobs booked 65 · $3.40 back for every $1.* Those are the right numbers — and for local-service clients we cannot compute any of them today. They require **call tracking** (CallRail or similar, not in our confirmed stack) and a **job/revenue signal** from the client's CRM or field-service software. GA4 gives us form conversions; it does not give us booked jobs or revenue per lead.

This is the single biggest gap in the review. Options, in order of preference:
- Standardize call tracking across local-service clients as part of onboarding (a real line item, ~$45–70/client/mo, arguably billable)
- Failing that, portal headline metrics for local clients fall back to *calls from GBP + form conversions*, and cost-per-job disappears
- eCommerce clients are fine — Shopify/GA4 gives revenue directly

**2. The Automation module describes work we may not be doing.**
Missed-call text-back, post-job review requests, renewal reminders, quote follow-up — shown as *Running* with volume counts. Confirm per client which of these actually exist. If they don't, this module is a roadmap, not a dashboard, and it cannot appear in a client portal until it's true. (It is, separately, an excellent upsell menu.)

**3. Approval capacity is real work.** Design implies a median 38-second decision — good target. At 13 clients that's still meaningful daily pod time. Instrument it from day one: if queues exceed the 24h SLA consistently, the fix is fewer and better recommendations, not more clicking.

**4. Client-visible progress cuts both ways** (playbook slippage, punch-list #3). Pods set realistic dates; slipped items show a reason, never a silent red bar.

**5. Accuracy gate applies per module**, not per product: each tab runs two full collection cycles parallel-checked against the platform UI before any client sees it.

**6. Sample data in the design mixes plausible and invented client names.** Standardize on fictional names before this is demoed to anyone.

---

## Joint recommendation — the order to do this in

1. **This week, zero build:** submit Google Ads developer token, submit GBP API access, generate the Meta system-user token, get a yes/no on the PostFlow API, and decide the call-tracking question. Five items, all calendar-time, all currently blocking design surfaces.
2. **Then:** Supabase Auth + RLS (gate for everything client-facing) and the screenshot service — the two infrastructure pieces the whole design rests on.
3. **Then:** agency side, one client, one change type end to end — WP staging → approval card → publish → ledger → measurement.
4. **Then:** Meta paid controls with spend guards, ClickUp sync.
5. **Then:** client portal v1 for a single pilot client, limited to modules with verified data.
6. **Last:** campaign creation, Bloom creative loop, LinkedIn — highest risk and longest approval lead time.

**What the design should change to reflect reality:** mark GBP, LinkedIn, and Google Ads panels as "connection pending" states rather than populated, so nobody demos a screen we can't fill. The design already handles honest states beautifully — apply that same discipline to unavailable integrations.
