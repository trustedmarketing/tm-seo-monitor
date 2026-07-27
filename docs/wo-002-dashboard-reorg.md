# WO-002 — Growth OS Dashboard Reorg (channel-oriented, revenue-first)

**Status:** ✅ SHIPPED — v1 + v1.5 merged via PR #13, live in production 2026-07-23 · Owner: CTO
**Source:** synthesized from a 4-role consult (CTO, COO, Head of Performance, Head of Social) on 2026-07-23.
**Update channel:** `WORKLOG.md` (repo root).

> **This is the only WO-002.** A second document was also drafted as "WO-002"
> (the two-sided SaaS spec); since this one was already built and shipped, that
> one was renamed to `docs/spec-growth-os-two-sided.md` and is implemented by
> `docs/wo-003-design-implementation.md`. Resolved 2026-07-27.
>
> **Not shipped from the list below:** the Search view (needs the GSC-query ×
> paid-search-term join) is a placeholder route; per-client cron fan-out was
> deferred after parallelization proved sufficient at current client count.

---

## Problem

The dashboard is "SEO-shaped": `/dashboard` is a grid of organic-search tiles, and paid + revenue
were bolted onto a separate `/command` page (Module A: MER hero + over-attribution flag). Now that
the platform carries real multi-channel data (SEO + Meta spend + Shopify revenue → MER 1.84× on
Salty Dog, with Google/Microsoft ads built and Social coming), the information architecture no longer
fits. Two homes for "how's the client doing" is the core defect.

## The reframe

**Revenue is the spine; the query/landing-page is the atomic unit; channels are overlays.** Every
tile must name a person and a decision or it gets cut. The goal is an *operator-shaped* dashboard,
not an SEO-shaped one.

## Decisions (locked)

1. **Social scope** — organic-social is the net-new build (fast-follow); **paid-social is surfaced
   under Paid now** (nearly free — Meta spend already flows; leaving it unlabeled corrupts per-platform
   ROAS). Split by *budget mechanic* (did money buy the impression), never by platform.
2. **Primary lens** — **single-client deep-dive first** (only client with full real data; where billable
   work happens), with a **thin portfolio exception/alarm strip** as the router/entry point.
3. **v1 ambition** — **restructure existing SEO+Paid+Revenue into channels now, Social fast-follow** —
   but lock the full four-group shell + shared data model upfront so Social slots into a reserved shelf.

## Target information architecture

```
/dashboard                     Portfolio roll-up  (thin: MER · revenue Δ · spend Δ · status dot per client; exception-driven)
/dashboard/[client]            OVERVIEW  (revenue-first hero — absorbs /command Module A; default landing)
/dashboard/[client]/organic    ORGANIC   { SEO/Search · AI-GEO · Social (organic) }
/dashboard/[client]/paid       PAID      { Meta · Google · Microsoft · paid-social breakout }
/dashboard/[client]/revenue    REVENUE   { Shopify ground truth: orders · AOV · revenue by source }
/dashboard/[client]/search     SEARCH    { organic + paid on the same query × landing page }   ← high-value add
/command                       → 301 redirect to /dashboard/[client] (retire; do not run in parallel)
```

Path-aware: the channel shell renders per `tm_path` (ecommerce → Revenue = Shopify; service → a
leads/pipeline variant of the same slot). Build the shell path-aware once.

## The high-value adds (what makes it more than a reorg)

- **Search view** (Head of Performance's top pick): organic + paid on the same query and landing page
  → catches **cannibalization** (paying for queries already ranking #1) and **gaps** (organic p2 held
  up by paid). Landing-page-level revenue is the shared currency of SEO + Paid — currently absent.
- **Blended MER *and* per-platform ROAS side by side** — MER says *there's a problem*; per-platform
  ROAS says *which knob*. Add nMER/aMER (new-customer) if feasible for ecommerce.
- **Over-attribution as reconciliation math, not a boolean** — show Shopify actual vs sum-of-platform-
  claimed inline, overlap %, plain-language line; always visible, not only when >85% trips. Mark
  Shopify as "actual" / platforms as "platform-reported" everywhere.
- **Alerts / anomaly feed** driving the portfolio status dots (MER drop, spend spike, top keyword off
  p1, ROAS collapse, LP 404, wasted spend). Turns a report into a tool.
- **Deltas + sparklines on every tile** + a **global time-range control** (7/28/90d + compare).
- **Data-freshness / connection status** ("Google Ads pending link", "Social not collected",
  "GA4 synced 2h ago") — never act on half-connected data that looks complete.
- **Organic→Paid creative pipeline** — winning organic posts flagged "paid-ready" feed the paid team;
  organic content themes feed SEO/GEO. A named handoff (Head of Social × Head of Performance).

## Shared data model (the forward-compatible seam)

Introduce a normalized `channel_metrics` shape so Overview / Search / by-source join across silos
without bespoke glue: `(client_id, channel, subchannel, date, spend, revenue_attributed,
impressions, clicks, conversions, source)`. SEO and Paid models stay for depth; this is the join layer.
Design it so **source is just an attribute** — Social drops in as new rows, not a new tab's rebuild.

## Build sequence

### v1 — Restructure (no new data collection)
- [ ] Channel shell + routes (Overview / Organic / Paid / Revenue / Search), path-aware.
- [ ] **Revenue-first Overview** — port `/command` Module A (MER + reconciliation) into it; make default.
- [ ] Push all SEO detail (keywords, backlinks, visibility) *down* into Organic; demote site-health to a chip.
- [ ] Paid channel: Meta live; Google/Microsoft as "connect account" empty states; paid-social breakout.
- [ ] Revenue: Shopify orders/AOV/by-source.
- [ ] **Search view** (organic + paid × query/landing page) + cannibalization flag.
- [ ] Thin **portfolio exception strip** on `/dashboard` (MER/rev Δ/spend Δ/status dot).
- [ ] Deltas + sparklines + global time-range control; data-freshness badges.
- [ ] Ship on Salty Dog (full real data). `/command` → redirect.

### v1.5 — De-risk the pipeline (HARD GATE before Social / more clients)
- [ ] Refactor the daily cron from one monolithic 300s-bound run to **fan-out per (client × source)**
      (Vercel Cron → multiple endpoints, or a queue: Supabase queue / QStash / Inngest). Sequential
      SEO/AI API latency is the killer; parallelize across invocations. This also fixes the SEO-snapshot
      staleness properly and unblocks multi-client scale + failure isolation.
- [ ] Date-partition / retention on collection-history tables before Social multiplies row counts.

### v2 — Social fast-follow
- [ ] Paid-social labeling under Paid (cheap — existing Meta data).
- [ ] **Organic-social collector**: Meta Graph (IG Professional + FB Page insights — already in stack) +
      GA4 (organic-social sessions + assisted revenue = the revenue bridge). TikTok / LinkedIn later.
- [ ] Social metrics ranked by distance-to-revenue: lead with organic-social assisted revenue + saves/
      shares + profile→site; vanity (followers/reach/likes) trend-only, never a hero. Report organic
      social as demand-gen + creative-supply (honest floor = last-click; + GA4 assisted; + branded-search
      lift) — do **not** force a fake ROAS into the MER hero.

## Risks / open questions

- **Attribution coherence:** decide once whether channel tabs show platform-claimed, modeled/blended,
  or both — inconsistent definitions across tabs erode trust. Shopify stays the arbiter.
- **Empty-state honesty:** Google/Microsoft/organic-social blank for most clients initially — design
  deliberate "not connected" states, not zeros that read as failure.
- **Client-facing view** is a **v2**, a deliberately-reduced copy of Overview (strip attribution
  internals, other clients) — gate hard; a client seeing an over-attribution warning or another
  client's data is the one trust-breaking failure.
- **Two-surface debt:** keep a `/command` redirect until fully absorbed; never run both in parallel.

## Immediate follow-up already applied

- SEO summary snapshot for Salty Dog hand-patched to real values (7,696 traffic / 229 kw / 976
  backlinks / 14.84% visibility) as a stopgap; v1.5 cron refactor is the durable fix.
