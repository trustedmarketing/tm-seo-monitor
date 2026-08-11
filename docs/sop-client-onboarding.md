# SOP — Adding a client to Growth OS

The order below is the order things depend on each other. A client added
correctly starts producing data on the next 10:00 UTC collection and appears in
the 10:30 UTC daily brief the same morning.

**Owner-only steps are marked ⚑.** Everything else is any agency role.

---

## Before you start

Have these to hand. Stopping halfway to go and find one is how a client ends up
half-configured and quietly collecting nothing:

- Client's domain (bare, lowercase — `example.com`, not `https://www.Example.com/`)
- Tier: Consistency · Momentum · Dominate
- Client type: local service · national eCommerce · hybrid
- Google Search Console property string
- GA4 property ID
- Their Slack channel's incoming webhook URL (for the daily brief)
- Shopify custom-app Client ID + secret, if eCommerce

---

## 1. Create the client — `/admin`

Name, domain, tier, **client type**, GSC property, GA4 property ID, location code.

**Client type is not optional in practice.** It decides which tabs the workspace
shows — eCommerce gets Revenue in Overview, local service gets GBP and
Automation. Left blank, the client gets the universal tab set and nobody has
decided anything; `/admin` shows an "Unclassified" badge so the gap stays
visible rather than silently defaulting.

**Location code** defaults to `2840`, which is the entire United States. For a
local business competing in one metro that is wrong, and the rankings still look
plausible — which is what makes it dangerous. Look up the city/metro code via
DataForSEO's `serp_locations` endpoint for any local-service client.

---

## 2. Keywords and prompts — `/admin`, with the client selected

- **Suggest keywords** — merges GSC top queries with DataForSEO ranked keywords.
  Add from the list, and paste any existing list into the textarea.
- **GSC backfill** — pulls up to 16 months of daily clicks/impressions/position
  so the client has history from day one instead of starting flat.
- **Prompts** — the customer-voice questions buyers actually ask. These drive
  the AEO section. Each prompt is a billed AI check per provider per run, so
  write ones worth paying for: "best X for Y", not "what is X".

---

## 3. Settings — `/dashboard/[id]/settings`

Everything that used to need hand-written SQL.

| Field | Notes |
|---|---|
| GA4 property ID | Digits only. **A wrong ID looks exactly like a permissions error** — verify against GA4 → Admin → Property Settings before assuming access is the problem. This cost six days once. |
| Search Console property | Exact form matters: `sc-domain:example.com` for a Domain property, `https://example.com/` **with trailing slash** for URL-prefix. |
| PostFlow group ID | Required for social analytics. |
| Slack webhook URL | The client's **own** channel — see §5. |
| Competitor domains | Stored normalised to bare lowercase hostnames. |
| Social posts / month | Their contracted cadence. Blank falls back to the playbook minimum and says so. |

⚑ **Platform connections** (Shopify, WordPress) are owner-only. Secrets are
write-only — the page shows whether one is *set*, never its value.

For Shopify, verify immediately with `/api/ops/shopify-check?client=<id>`. It
runs the same preflight the publish path uses, so the check and the execution
path cannot drift apart. Look for `can_write_content: true` and no
`over_privileged` scopes.

---

## 4. ⚑ AI answer checks — Settings → "AI answer checks"

**Owner-only, because this is a spend decision.**

- **Assistants**: ChatGPT is the always-on baseline. Gemini and Claude are
  opt-in. Each one is a separately billed call **per prompt, per run** — turning
  both on roughly triples that client's AEO cost.
- **Cadence**: weekly by default. Daily costs ~7× for granularity AI visibility
  does not have — a brand does not appear in ChatGPT on Tuesday and vanish on
  Wednesday.
- Google AI Overviews are always included and cost nothing extra: they arrive in
  the SERP data already bought for keyword rankings.

Check the projected cost before and after at `/api/ops/dataforseo-check` →
`aeo.by_client`. It reports monthly spend per client and what it would be with
every provider enabled.

---

## 5. Slack webhook for the daily brief

**One channel per client, pasted one at a time, on that client's own Settings
page.**

Do not batch these. A mismatched webhook sends **one client's revenue and spend
figures into another client's Slack channel**, and nobody notices — the client
on the receiving end just quietly reads someone else's numbers. Paste it, save,
and confirm the client name at the top of the page is the one you meant.

A client with no webhook is silently skipped rather than erroring, so it is safe
to add these gradually.

> **This is not the same as `SLACK_WEBHOOK_URL`.** That env var is ONE internal
> ops channel carrying collector failures, token expiry, SLA breaches and
> revenue mismatches across every client. It must never point at a client
> channel.

---

## 6. ⚑ Spend guardrails — `/dashboard/[id]/paid/guardrails`

If the client runs paid, set daily and monthly ceilings per platform **before**
any campaign work. Any approval that would breach one is blocked and escalated
rather than approved through.

The page shows committed daily budget from active campaigns beside the ceiling,
because a ceiling typed without knowing current spend is a guess — and the usual
way a guardrail fails is being set so high it never fires.

Owner-only: if the person who wants a big budget through can also lift the limit
that stops it, the limit is decoration.

---

## 7. Verify — do not skip this

Per the accuracy gate in `CLAUDE.md`, **no module is client-visible until it has
run two full collection cycles parallel-checked against the platform's own UI.**

Trigger a collection rather than waiting a day:

```
curl -H "Authorization: Bearer $CRON_SECRET" https://seo.trustedmarketing.com/api/cron/collect
```

Then check:

- **Portfolio page** — the client appears with a freshness stamp, not "collecting".
- **Attention rail** — any failure now states *why*. Fix before moving on.
- `/api/ops/ga4-check?client=<id>` — GA4 reachable, right property.
- `/api/ops/dataforseo-check` — balance moved (proves the run happened);
  `pending_tasks` shows a crawl queued.
- **eCommerce only**: compare the Overview's 30-day revenue and order count
  against the client's own Shopify dashboard on "Last 30 days". Order count is
  the cleaner signal — it can't be explained away by refunds or valuation
  differences. If they disagree, stop and find out why before the client sees it.

Once numbers reconcile, revenue reconciliation takes over automatically and
alerts if they ever drift again.

---

## 8. Read the first daily brief before adding the webhook

The brief runs at 10:30 UTC. Read the client's section in your consolidated
email **before** pasting their Slack webhook — once it's in, the content goes
straight to them with no further review.

---

## Common failure modes

| Symptom | Almost always |
|---|---|
| GA4 "permission" error | Wrong property ID, not access. Check the digits first. |
| GSC 403 | `gsc_property` string form (`sc-domain:` vs `https://…/`), or the service account isn't a Full user on that property. |
| Revenue doesn't match Shopify | Compare **order counts** first — if those differ, it's a window or filter problem, not a valuation one. |
| Client shows "collecting" forever | No keywords or prompts added, or `serp_frequency` is `paused`. |
| No AI answers | Client has no tracked prompts, or `ai_frequency` is `paused`. |
| No Slack brief | No `slack_webhook_url` on that client. Silent by design. |

---

## What is NOT self-serve

These need Tom (external accounts — see `CLAUDE.md`'s escalation list):

- Any new Vercel env var, and the **redeploy** after it (env changes don't reach
  an already-built deployment)
- Migrations — serialized, run in order, staging first
- Generating platform tokens, and the Slack app/channel per client
