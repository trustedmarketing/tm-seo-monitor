# Trusted Marketing Growth OS — Platform Plan
### From SEO monitor to full-funnel client growth engine
**Prepared July 2026 · For: Trusted Marketing CTO · Status: planning**

---

## 1. What we're building

One login at seo.trustedmarketing.com (rename candidate: growth.trustedmarketing.com) that shows the complete performance picture for every client — organic search, AI answer visibility, paid media across every platform, creative performance, and organic social — and then closes the loop: the system diagnoses, recommends, executes changes (via git PRs, WordPress, or ad platform APIs), timestamps every change, and measures whether it worked.

The operating loop, which every module must implement:

**Observe → Diagnose → Recommend → Execute → Measure → Learn**

This loop already exists end-to-end for SEO (shipped): daily collection, rules-based recommendations with lifecycle status, a change ledger, and automatic 28-day before/after measurement with verdicts. The plan below extends the same loop to paid, creative, and social, on the same Supabase + Vercel + Next.js foundation.

**What exists today (do not rebuild):**
- Daily collector (Vercel cron) → DataForSEO (rankings, traffic estimates, backlinks, site health, LLM answer checks) + Google Search Console (real clicks, 16-month history)
- Recommendations engine with lifecycle (open → approved → measuring → validated/no_effect)
- Change ledger with automatic before/after measurement and verdicts
- Client detail pages with date ranges; research tools (audit / competitors / keyword research)
- Role-based access (viewer / admin), TM design system throughout
- Repo: trustedmarketing/tm-seo-monitor · Supabase project xelweikfciqakagkerat · Vercel project trusted-marketing-seo

---

## 2. Client-type awareness (local vs. national)

Every module behaves differently depending on client type, so this is a data-model concern, not a UI afterthought. Add to the `clients` table:

- `client_type`: `local_service` | `national_ecom` | `hybrid`
- `service_areas`: array of geo definitions (city/county + DataForSEO location codes) for local clients
- `gbp_location_ids`: Google Business Profile locations
- `store_platform`: `shopify` | `woocommerce` | `custom` for eCommerce

**Local clients (Sharkey Air, Group One, Alpha Zeta, etc.):**
- Rank tracking runs per service-area location code, not national — a #3 in Martin County is the number that matters
- Add **local pack / Maps rank tracking** (DataForSEO SERP API returns local pack results; a geo-grid of coordinate points per service area produces the Ahrefs/LocalFalcon-style heat map)
- GBP metrics become first-class: calls, direction requests, profile views, review velocity and rating trend (Google Business Profile Performance API — access application has lead time, start now)
- AEO prompts are geo-flavored ("best AC repair in Stuart FL") and checked accordingly

**National eCommerce (Salty Dog, DAPS, arX, Briny Brim):**
- National + shopping SERP tracking (DataForSEO covers shopping results), product-level keyword mapping
- Revenue is the ground truth: GA4 ecommerce events and/or Shopify Admin API orders join every measurement window, so verdicts read "revenue +X%" not just "clicks +X%"
- AEO prompts are product/comparison queries ("best salt remover for boats", "X vs Y")

---

## 3. Module map

### Module A — Command dashboard
The portfolio page evolves from an SEO card list into a per-client scorecard with a channel strip: Organic · AI · Paid · Social · Site, each with a headline number and trend, drilling into module tabs on the client detail page. Local clients lead with local-pack position + calls; ecom clients lead with revenue + ROAS + organic visibility. One "attention" view across all clients: everything declining, every measurement verdict that came back negative, every budget pacing alarm — the account manager's morning page.

### Module B — Search & AEO (extend what's built)
Extensions, in priority order:
1. **Conversion-weighted keywords.** "Keywords that convert and actually matter" requires joining GA4: pull landing-page conversions and assisted revenue, map to ranking pages, and weight the Visibility score and recommendations by business value, not just volume. A keyword driving demo requests outranks a trivia keyword at 10x volume.
2. **Per-URL GSC.** Store the page dimension (add `gsc_pages` daily table) so change measurement compares the *affected URLs'* clicks, not domain totals — much sharper verdicts.
3. **Local pack tracking** (per §2).
4. **AI visibility v2.** Multi-model checks (DataForSEO's AI Optimization endpoints cover more than ChatGPT), competitor share-of-voice per prompt (who *is* cited when we're not), and prompt suggestions generated from the keyword list.
5. **Algorithm-update annotations.** Maintain a table of known Google update dates; measurement windows overlapping an update get flagged, keeping verdicts honest.

### Module C — Paid media
One `ad_platform_accounts` table (client, platform, external account id, auth ref) and one normalized `ad_metrics_daily` table (date, platform, campaign, adset, ad, creative_id, impressions, clicks, spend, conversions, revenue) that every platform collector writes into. Platform order by effort-to-value:

1. **Meta** — Marketing API via a system user token in the TM Business Portfolio (ID 1230345685227021, already used for client partner access). No approval wait. Campaign/adset/ad insights + creative assets. First to ship.
2. **Google Ads** — requires a developer token from an MCC; application has days-to-weeks lead time. **Submit this week regardless of build order.** Once granted: campaign + asset-level performance, PMax channel splits, search terms.
3. **Microsoft (Bing) Ads** — straightforward API, developer token is near-instant, and Bing often over-delivers ROI for local service categories. Low effort.
4. **Reddit Ads** — has a proper Ads API (OAuth); relevant for the ecom brands. Medium priority.
5. **OpenAI / ChatGPT Ads** — live channel since February 2026; self-serve Ads Manager (beta) with CPC/CPM and, since May, a Conversions API and pixel. Programmatic reporting access is immature — start by running campaigns for one ecom client, track via the OpenAI pixel + UTMs into GA4, and integrate API reporting as it stabilizes. Being early here is a genuine agency differentiator; almost no local competitor will be running AI-channel ads this year.

Paid recommendations engine (same rules pattern as SEO): budget pacing vs plan, ROAS below tier threshold, creative fatigue (frequency up + CTR down), asset-level "Low" performers needing replacement, search-term waste → negative keyword suggestions, audience overlap.

### Module D — Creative intelligence & generation
Two halves:

**Analysis.** Store every ad creative (image/video ref, copy, format, platform) in a `creatives` table joined to `ad_metrics_daily`. A weekly Claude pass tags each creative on a taxonomy — hook type, format, angle, offer, UGC vs produced, brand-color compliance — so performance can be cut by *attribute*, not just by ad: "UGC testimonial hooks outperform product-hero shots 2.3x for this client." (Motion Creative Analytics is already connected via MCP and does exactly this for Meta; decision for CTO: integrate Motion's insights vs build the tagging in-house on the Claude API. Recommendation: start with in-house tagging since the data's already flowing and it works across all platforms, not just Meta.)

**Generation.** The pipeline: recommendation ("creative fatigue on campaign X" or "test a comparison-angle hook") → Claude drafts copy variants + a creative brief that references the client's design file (each client gets a design-tokens file in their tm-clients workspace: colors, fonts, logo rules, voice — the TM design system handoff is the template for producing these) → Figma REST API / Figma MCP instantiates the brief into on-brand creative from component templates → export → upload to the ad platform **paused**, linked to the recommendation, awaiting human approval to launch. Launch date lands in the change ledger; measurement attaches automatically. Build one master "ad template" component set per client in Figma (sizes: 1:1, 4:5, 9:16, plus display sizes) so generation is instantiation, not design-from-scratch.

> **Under evaluation (2026-07):** [Bloom / trybloom.ai](https://www.trybloom.ai) as the *primary* volume-generation engine, with Figma demoted to a **precision tier**. Bloom offers a native Claude Code MCP + REST API and learns a brand from its URL/Instagram — removing the per-client Figma template build. Full evaluation and adopt/adopt-for-subset/pass recommendation in `docs/bloom-eval.md`; status in `STATUS.md`. Gating items before adoption: real brand fidelity vs tokens, 4:5 support, and written answers on agency/client-use rights, model-training opt-out + DPA, and IP risk. Either way, the generation engine sits behind our own `creatives` table + a thin `generateCreative(brief, brand, sizes)` interface so assets are re-hosted in our storage and the vendor stays swappable (zero lock-in).

### Module E — Organic social
**Ingestion:** Meta Graph API covers IG + FB organic (posts, reach, saves, shares, comments, profile actions) through the same Business Portfolio auth as ads. LinkedIn Community Management API for the B2B clients. TikTok/YouTube as needed per client. PostFlow remains the publishing tool; this module is the *analysis* layer (check whether PostFlow exposes an API/export — if so, ingest scheduled-post metadata so analysis and publishing share IDs).

**Analysis:** `social_posts` + `social_metrics_daily` tables; the same Claude tagging pass as creatives (format, hook, topic, CTA type, post length, native-vs-link). Recommendations engine rules: formats/hooks over- and under-indexing for this account, posting-time windows with highest engagement velocity, series-worthy outliers ("this post did 6x median — make it a recurring series"), link-post penalty detection, response-time gaps on comments.

**Content suggestions:** monthly, Claude generates a content slate per client from what's working (theirs + competitor accounts' public posts) aligned to the design file voice — delivered as drafts into the approval flow, not auto-posted.

### Module F — Execution layer (the hands)
Three adapters, one contract: every executed change lands in the existing `changes` ledger with source, timestamps, and affected targets, so measurement is uniform.

1. **Git sites** — Claude Code GitHub Actions (`anthropics/claude-code-action@v1`): approval on a recommendation fires a `repository_dispatch` to the client repo with the rec payload; Claude implements within CLAUDE.md guardrails (voice, design tokens, allowed paths) and opens a PR titled with the rec ID; merge webhook flips the ledger to shipped. Human merges everything in v1; low-risk classes (meta titles, alt text, schema, llms.txt) graduate to auto-merge on track record.
2. **WordPress** — adapter via WP REST API (application passwords) for content/meta changes, or WP Engine git deploys for theme-level work (already proven on Masterpiece). Drafts are created in WP as `pending review`, never published directly, v1.
3. **Shopify** — Admin API for products/pages/metafields; theme work via the GitHub theme integration → same PR flow as git sites.

All new pages and blog content generated through this layer follow the client design file: the per-client CLAUDE.md includes the design tokens, component patterns, and content voice, so generated pages are on-brand by construction.

### Module G — Measurement, attribution & learning
- GA4 Data API becomes the conversion spine for every module (API already enabled; grant service-account Viewer per property as clients are onboarded)
- Extend change measurement: per-URL GSC, revenue windows for ecom, per-platform paid metrics for creative launches
- Every verdict accumulates into a `learnings` view: change type × client type × outcome — the cross-portfolio intelligence layer ("schema additions validate 70% of the time for local service in ≤3 weeks"). This is the moat: 13 clients' worth of causally-tagged outcomes no single client could produce.
- Honest-attribution rules: overlapping algorithm updates flag verdicts; overlapping paid pushes flag organic verdicts; inconclusive is a first-class outcome.

---

## 4. Data architecture (Supabase additions)

```
clients                 + client_type, service_areas jsonb, gbp_location_ids text[], store_platform
gsc_pages               (client_id, date, url, clicks, impressions, position)
local_rank_checks       (client_id, keyword_id, grid_point, pack_position, maps_position, checked_at)
ad_platform_accounts    (client_id, platform, external_id, status, auth_ref)
ad_metrics_daily        (client_id, platform, date, campaign_id/name, adset, ad_id, creative_id,
                         impressions, clicks, spend, conversions, revenue)
creatives               (client_id, platform, creative_id, type, asset_url, copy, tags jsonb, first_seen)
social_posts            (client_id, platform, post_id, posted_at, format, copy, tags jsonb, permalink)
social_metrics_daily    (post_id, date, reach, likes, comments, shares, saves, video_views)
conversions_daily       (client_id, date, source, sessions, conversions, revenue)   ← GA4/Shopify
algo_updates            (date, name, scope)
learnings               (view over changes × clients × verdicts)
```
Existing tables (recommendations, changes, metric_snapshots, gsc_history, keyword_rankings, tracked_prompts, prompt_results) unchanged — everything joins to them.

---

## 5. API & service inventory

| Capability | Provider / API | Auth | Lead time | Est. cost |
|---|---|---|---|---|
| Rankings, backlinks, site health, keyword research, AI answer checks, local pack | DataForSEO (in place) | Basic auth | none | ~$30–60/mo now; +local grids ~$1–3/client/mo |
| Real search traffic | Google Search Console API (in place) | Service account | none | free |
| Conversions / revenue spine | GA4 Data API (enabled) | Same service account, Viewer per property | grant per client | free |
| GBP calls/views/reviews | Business Profile Performance API | Google access application | **weeks — apply now** | free |
| Meta paid + IG/FB organic | Meta Marketing API + Graph API | System user token, Business Portfolio 1230345685227021 | none | free |
| Google Ads | Google Ads API | Developer token via MCC | **days–weeks — apply now** | free |
| Microsoft Ads | Bing Ads API | Developer token | ~instant | free |
| Reddit Ads | Reddit Ads API | OAuth app | short | free |
| ChatGPT ads | OpenAI Ads Manager (self-serve beta) + Conversions API/pixel | Ads account | none | media spend only |
| Shopify data + execution | Shopify Admin API | Custom app per store | none | free |
| WordPress execution | WP REST API / WP Engine git | App passwords / deploy keys | none | free |
| Git execution | Claude Code GitHub Actions (`claude-code-action@v1`) | ANTHROPIC_API_KEY secret per repo | none | ~$0.10–1.00 per PR task |
| Creative tagging, briefs, content, social slates | Claude API (Sonnet for tagging, Opus/Fable for briefs) | API key | none | est. $20–80/mo across 13 clients |
| Creative generation | Figma REST API + component templates | Figma token (MCP already connected) | template build effort | plan cost only |
| Publishing (existing) | PostFlow | existing | — | existing |

---

## 6. 2026 channel playbooks (what "good" means, per channel)

These are the standards the recommendations engines encode — the rules are the playbook, automated.

**Organic social 2026:**
- Engagement quality over follower count: platforms distribute on early engagement velocity (comments, shares, saves), and depth of community beats reach; a small engaged audience out-converts a large passive one
- Short-form video is the reach engine (3–5x static), but carousels win saves/comments for educational content; every post lives or dies on its first line / first frame hook
- On-platform native content wins; link-heavy posts are effectively penalized (Facebook referral traffic to publishers has collapsed >75% since 2018) — links go in first comments, traffic goals go to paid/email
- Authenticity premium: UGC drives ~28% higher engagement and reads 2.4x more authentic than branded content; audiences increasingly discount obviously-AI-generated creative — use AI for the science (analysis, timing, distribution), humans for the art
- Respond fast: comment replies inside the first hour amplify distribution; sub-24h response is the consumer expectation
- Recurring series beat one-offs — give the audience something to return for

**SEM / PPC 2026:**
- AI-driven campaign types are the default (PMax now ~45% of Google Ads conversions; adoption ~71%); the job shifted from bid management to *feeding the machine*: clean conversion data, first-party audiences, differentiated creative, precise audience signals
- Automation ≠ abdication: themed asset groups, weekly asset-report reviews replacing "Low" performers, guardrails on targets; budget ~10–20x target CPA during learning
- First-party data + Conversions APIs (Meta CAPI, Google Enhanced Conversions, now OpenAI CAPI) are the measurement backbone as privacy regs (CCPA 2.0, EU AI Act) bite
- Channel benchmarks for verdict thresholds (break-even ROAS): Search ~3.5–4.5, Meta prospecting ~2–3, PMax ~3–4 — encode per-tier targets per client
- New inventory: conversational/AI placements (ChatGPT ads, Google's AI-surface ads) reward intent-context matching over keyword matching — early-mover advantage is real and shrinking

**SERP / SEO 2026:**
- Zero-click is the default condition; ranking #1 and being *the extracted answer* are different achievements — optimize pages to be both
- Entity and topical authority beat page-level tricks: consistent NAP/entity signals, author expertise, structured data everywhere it applies
- Conversion-weighted keyword strategy: rankings only matter on queries tied to revenue; prune vanity keywords from tracking and reporting
- Local: the pack is the SERP; GBP completeness, review velocity + owner responses, and geo-grid position are the local trinity
- Technical floor still gates everything (the site-health rule already encodes this)

**AEO / GEO 2026:**
- AI citation ≠ Google ranking: overlap between top Google results and AI-cited sources has fallen to ~20% and models differ from each other (<1% ChatGPT/Perplexity citation overlap) — optimize per platform, measure per platform (our prompt checks already do)
- Structure for extraction: answer-first 40–60 word blocks, definition-led sections, inverted pyramid; schema markup materially improves extractability
- Third-party consensus drives citations: ~85% of brand mentions in high-intent AI answers come from third-party sites, not brand-owned pages — AEO is as much digital-PR/mention-building as on-site work
- Evidence-anchored claims (dated, sourced, verifiable) get cited; unsupported marketing copy doesn't
- llms.txt + clean crawlability for AI bots (GPTBot etc.) — already in the TM playbook
- AI-referred visitors convert fast and browse shallow: landing pages for cited content should convert in one screen (fewer form fields measurably lifts AI-visitor conversion)

---

## 7. Build sequence

**Phase A (now → +2 weeks): foundations that unblock everything**
Apply for Google Ads developer token + GBP API access (calendar time, zero build). Meta system-user token. Add client_type/service_areas to schema. GA4 collector into `conversions_daily` (per-client Viewer grants as onboarded). Roll remaining 12 clients into the current monitor (per Appendix A runbook, Dominate tier first).

**Phase A.5 (+1 → +3 weeks, overlaps A): operational hardening** *(added per CTO review — prerequisite for every collector that follows)*
- **Job orchestration:** split the single cron into per-module jobs with a `jobs` queue table (retries, idempotency keys); the 300s function ceiling fails at 13 clients × multi-channel. Backfills run as queued chunks, never in one request.
- **Secrets vault:** per-client platform tokens move from env vars into Supabase Vault (encrypted), tracked with expiry dates and proactive re-auth alerts. `auth_ref` points here.
- **Observability:** `collector_runs` table (module, client, status, error, duration) + Slack webhook alerts on failure and on staleness (no fresh data for a client in >36h). Silent staleness is the worst client-facing failure mode; this closes it.

**Phase B (+2 → +6 weeks): paid media v1 + smarter SEO + delivery integration**
Meta ads collector + paid dashboard tab + paid recommendations rules. Microsoft Ads collector. Per-URL GSC + conversion-weighted keyword scoring. Local pack tracking for local clients. ChatGPT ads pilot on one ecom client (Salty Dog or DAPS) with pixel/CAPI tracking. **ClickUp sync** *(promoted per COO review)*: approved recommendations auto-create ClickUp tasks in the client's list; task completion flows back to mark shipped — the pods work in ClickUp, so this is what makes the platform part of delivery instead of a parallel queue.

**Phase C (+6 → +10 weeks): creative + social**
Creative ingestion + Claude tagging + creative-performance view. Figma template component sets for 2 pilot clients; brief→Figma generation pipeline with human launch approval. Social ingestion (Meta Graph) + tagging + social recommendations. Google Ads collector when token clears.

**Phase D (+10 → +16 weeks): execution automation**
Claude Code PR flow on 2 git-based pilot sites (dispatch → PR → merge webhook → ledger). WordPress adapter (drafts-for-review). Auto-merge ladder for low-risk change classes. Reddit Ads if client demand.

**Phase E (ongoing): learning layer**
Learnings view + quarterly "what works" intelligence report across the portfolio; recommendation priorities re-weighted by validated outcomes.

---

## 8. Governance & guardrails
- Roles: current viewer/admin ships; **hard gate (CTO): Supabase Auth + per-client RLS policies must land before any client receives a login** — it's a ~1-week refactor touching every query, and it cannot be retrofitted after client access exists. Budget it explicitly, likely Phase C.
- **Accuracy gate (COO):** no module becomes client-visible until it has run two full collection cycles parallel-checked against the platform's own UI; measurement verdicts stay internal until the account manager approves surfacing them per client. One wrong ROAS in front of a client costs more than the dashboard has earned.
- **Staging requirement (CTO):** every execution adapter (git, WP, Shopify) ships with a dry-run mode and is rehearsed against a staging site before touching a live client property. No exceptions in Phase D.
- Client consent: retainer language must cover automated changes (even human-approved PRs) and ad-platform write access before Phase D touches a client property — CLO dependency, natural fit as a Dominate-tier feature.
- Autonomy ladder: everything human-approved in v1; auto-merge only for change classes with a validated track record; ad launches always human-approved.
- Secrets: every platform token lives in the Supabase Vault (per Phase A.5), referenced by `auth_ref`; nothing client-facing ever sees a token.
- **Operating cadence (COO):** recommendation queues are triaged weekly per pod with a named owner and an SLA from `open` to decision (see Appendix B); the cross-client attention view has a named daily owner. Unowned queues rot.
- **API health cadence (CTO):** quarterly check of platform API version deprecations (Meta sunsets versions ~every 2 years); upgrades scheduled, not discovered.
- **Tool consolidation:** define Agency Analytics sunset criteria now — proposed: when paid + social modules pass the accuracy gate and go client-visible, Agency Analytics is cancelled. Running both indefinitely is the drift this platform exists to kill.
- Honest reporting: inconclusive verdicts stay inconclusive; algorithm/paid-overlap flags surface on client-facing views

## 9. Cost picture (steady state, 13 clients)
DataForSEO ~$50–120/mo (with local grids + AI checks) · Claude API ~$20–80/mo (tagging/briefs) + ~$0.10–1.00 per executed PR · everything else is free APIs + existing subscriptions (Figma, PostFlow, ClickUp) + media spend. Total platform run-cost well under one Semrush seat, replacing Semrush + Ahrefs-style research + a creative-analytics tool + a social-analytics tool.

## 10. Open decisions
1. Motion integration vs in-house creative tagging (recommendation: in-house, Motion as reference)
2. PostFlow API surface — can scheduled posts be ingested/pushed?
3. Domain: keep seo.* or move to growth.* as scope expands
4. Which two clients pilot the execution layer (need git-based or WP Engine sites + Dominate-tier trust)
5. TikTok/YouTube organic: which clients justify the extra ingestion work
6. **Tier entitlement matrix (Tom + CFO decision):** which modules ship at Consistency / Momentum / Dominate — this is packaging and pricing, it shapes build priority, and it must be decided before client-visible launch. Natural Dominate differentiators: daily tracking, AI visibility, creative generation, execution layer.
7. Job queue technology for Phase A.5: Supabase pg_cron + jobs table (no new vendor) vs Inngest/QStash (better retries/observability out of the box)
8. Agency Analytics sunset date — confirm the criteria in §8 or set a calendar date

---

## Appendix A — Client onboarding runbook (60–90 min per client)

Repeatable checklist; assign an owner, schedule all 12 remaining clients deliberately (Dominate tier first — they fund the roadmap). One client per sitting; verify each step before the next.

1. **Profile** — /admin → Add client: name, domain, tier, client_type (local/ecom), service areas + DataForSEO location codes for local clients
2. **Keywords** — import the client's existing Semrush/tracking list; top up via Suggest keywords to 30–50, conversion-relevant terms only (no vanity keywords)
3. **AI prompts** — 10–15 customer-voice questions (geo-flavored for local, product/comparison for ecom); include the head-to-head comparisons buyers actually ask
4. **Search Console** — add tm-seo-collector service account as Full user on the property; set the exact property string in /admin (sc-domain: vs https:// form); run Backfill GSC history the same day (16-month window ages out monthly)
5. **GA4** — grant the service account Viewer on the property (Admin → Property access management)
6. **Frequencies** — set core/serp/crawl cadence per tier; Dominate gets the daily SERP option
7. **First collection** — force-run the collector; verify the report shows core / serp / ai / recs synced with no FAILED lines; spot-check the dashboard card against Search Console
8. **Paid + social (as Phase B lands)** — link ad accounts via Business Portfolio partner access; confirm token stored in vault with expiry date
9. **Log it** — completed onboarding recorded in the client's ClickUp space / monthly work log

## Appendix B — Recommendation triage cadence (one-pager)

**Owner:** each pod lead owns their clients' recommendation queues. **Attention view:** reviewed every business morning by [named owner — assign].

**Weekly rhythm (per pod, ~20 min per client):**
- Review new `open` recommendations → decide: Approve (creates ClickUp task once Phase B sync lands), Dismiss (with reason), or leave open no longer than one more cycle
- **SLA: no recommendation sits at `open` for more than 14 days.** An unworked queue destroys the system's internal credibility faster than any bug.
- Review anything that hit `measuring` → confirm the change log entry describes what actually shipped (measurement is only as good as the ledger)
- Review new verdicts (`validated` / `no_effect` / `inconclusive`) → validated wins get flagged for the client's monthly report; no_effect triggers a "what next" note; inconclusive overlapping an algorithm update gets annotated, not spun
- Client-facing rule: verdicts appear in client views only after the account manager approves them for that client (accuracy gate, §8)

**Escalation:** any measurement suggesting a shipped change *declined* performance goes to the pod lead same-day for a revert/iterate decision — declines are the system working, not the system failing, but only if acted on.
