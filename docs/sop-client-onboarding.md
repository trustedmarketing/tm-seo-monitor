# SOP — Adding a client to Growth OS

The order below is the order things depend on each other. A client added
correctly starts producing data on the next 10:00 UTC collection and appears in
the 10:30 UTC daily brief the same morning.

**Owner-only steps are marked ⚑.** Everything else is any agency role.

---

## Bulk onboarding — clients that already exist but are empty

For clients created in bulk (a SQL insert rather than `/admin`), the row exists
with name, domain, tier, type and location code, and nothing else. They will show
"collecting" and appear empty in the daily brief until the below is done. That is
expected, not a fault.

**The order is different from the single-client flow below, and it matters.**
`Suggest keywords` merges GSC top queries with DataForSEO's ranked keywords — run
it before Search Console is connected and you get the DataForSEO half only, which
is a meaningfully worse list. Google access first, keywords after.

### Once, for all clients

**1. Get the service account email.**

```
/api/ops/ga4-check
```

Returns `service_account_email` — the exact `…@….iam.gserviceaccount.com` string
to grant. Copy it once; it is the same for every client.

**2. Grant it access in Google, for every client at once.** This is the real
bottleneck — it is work in Google's UIs, not in this product, and nothing below
functions until it is done.

- **GA4**: each property → Admin → Property Access Management → add the service
  account as **Viewer**.
- **Search Console**: each property → Settings → Users and permissions → add it
  as **Full user** (not Restricted — the API needs full).

Do all of them in one sitting. Coming back to this per client is how half a
portfolio ends up connected and half does not.

### Then, per client

**3. Settings** (`/dashboard/[id]/settings`) — paste the GA4 property ID and the
Search Console property. Exact string form for GSC: `sc-domain:example.com` for a
Domain property, `https://example.com/` **with the trailing slash** for
URL-prefix. Getting this wrong reads as a 403, not as a typo.

**4. Verify before moving on** — `/api/ops/ga4-check?client=<id>`. Check
`property_id` against GA4 → Admin → Property Settings. **A wrong property ID
produces the identical error to a permissions problem**, so confirming the digits
here saves the afternoon that costs otherwise.

**5. `/admin`, client selected** — `GSC backfill` first (up to 16 months of
history, so the client does not start flat), then `Suggest keywords`, which is now
GSC-informed. Add the keywords worth tracking.

**6. Prompts** — the customer-voice questions buyers actually ask. Each is a
billed AI check per provider per run, so write ones worth paying for.

**7. Slack webhook** — last, and only after reading that client's section in a
real daily brief. Once the webhook is set, the content goes to them unreviewed.

### Sanity check across the whole portfolio

```sql
select name, client_type, location_code,
       ga4_property_id is not null as ga4,
       gsc_property   is not null as gsc,
       slack_webhook_url is not null as slack
from clients where active order by name;
```

Any local-service client still on `2840` is measuring national rankings.

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
- Ad account IDs for every platform they run — Meta `act_…`, Google Ads customer
  ID, Microsoft account ID (§6). Read them from the platform rather than from an
  email; both are one API call away

---

## 1. Create the client — `/admin`

Name, domain, tier, **client type**, GSC property, GA4 property ID, location code.

**Client type is not optional in practice.** It decides which tabs the workspace
shows — eCommerce gets Revenue in Overview, local service gets GBP and
Automation. Left blank, the client gets the universal tab set and nobody has
decided anything; `/admin` shows an "Unclassified" badge so the gap stays
visible rather than silently defaulting.

**A national lead-gen client fits none of the three types.** `local_service`,
`national_ecom` and `hybrid` cover the portfolio as it was; a national B2B
business that sells by quote is outside all of them. Pick **`hybrid`** — it is
the least wrong. `client_type` decides the revenue block via `revenueMode()`
(`lib/workspaceTabs.ts`), and `hybrid` gives the honest `leads_pending` state,
where `national_ecom` would promise a revenue hero backed by a store that does
not exist. The cost is two irrelevant tabs (GBP, Automation), and both already
render holding states rather than empty numbers. A fourth type,
`national_lead_gen`, is the real fix — code, not an onboarding step.

**Location code** defaults to `2840`, which is the entire United States. For a
local business competing in one metro that is wrong, and the rankings still look
plausible — which is what makes it dangerous. Look up the city/metro code via
DataForSEO's `serp_locations` endpoint for any local-service client.

---

## 2. Keywords and prompts — `/admin`, with the client selected

**Connect Search Console (§3) before this.** `Suggest keywords` merges GSC top
queries with DataForSEO's ranked keywords; without GSC you get the DataForSEO
half only, and the list is meaningfully worse. The numbering here reflects where
these controls live, not the order to use them.

- **GSC backfill** — first. Pulls up to 16 months of daily
  clicks/impressions/position so the client has history from day one instead of
  starting flat.
- **Suggest keywords** — then. Add from the list, and paste any existing list
  into the textarea.
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

## 6. ⚑ Connect the ad accounts — `ad_platform_accounts`

**Do this for every client that runs paid, and verify it in SQL.** This is the
only connection in the whole onboarding with no UI, no ops endpoint, and no
failure signal.

`ad_platform_accounts` is read by all three ad collectors and written by nothing
in `src/` — it is a hand-written insert. Without a row, `collectMetaAds`,
`collectGoogleAds` and `collectMicrosoftAds` each return `0` and record a
**`skipped`** run.

> **Nothing surfaces a skipped run.** The attention rail selects
> `status = 'error'` only (`failingModules`, `lib/collectorHealth.ts`), and the
> client's freshness stamp is satisfied by its organic collectors. So an
> unconnected paid client shows an empty Paid tab, a healthy portfolio row, and
> no alert anywhere. For a paid-led client that is the entire engagement,
> invisible.

Run once the client row exists — by domain, so there is no UUID to copy wrong:

```sql
insert into ad_platform_accounts (client_id, platform, external_id, auth_ref)
select id, 'meta', 'act_XXXXXXXXXXXX', null
from clients where domain = 'example.com';
```

| Platform | `external_id` | `auth_ref` |
|---|---|---|
| `meta` | `act_` + digits | `null` falls back to the `META_ACCESS_TOKEN` system-user token. **Verify per client** — a system-user token is scoped to the Business Manager that issued it, so another client collecting fine proves nothing about this one. If the account sits in a different BM, mint a scoped token, vault it, and point `auth_ref` at it |
| `google_ads` | customer ID, digits only | `null`. Credentials are portfolio-level: `google_ads_oauth` + `google_ads_developer_token` vaulted once, MCC from `GOOGLE_ADS_LOGIN_CUSTOMER_ID`. The account must be linked under **MCC 711-022-5227** first |
| `microsoft` | account ID | `null` |

**One row per client per platform.** All three collectors resolve the account
with `.maybeSingle()`, which errors when a client has two rows for one platform.
A second ad account on the same platform cannot be added this way.

Verify after the next collection — `status = 'skipped'` means not connected,
however healthy the dashboard looks:

```sql
select module, status, detail, error, started_at
from collector_runs
where client_id = (select id from clients where domain = 'example.com')
  and module in ('meta_ads','google_ads','microsoft_ads')
order by started_at desc limit 10;
```

---

## 7. ⚑ Spend guardrails — `/dashboard/[id]/paid/guardrails`

If the client runs paid, set daily and monthly ceilings per platform **before**
any campaign work. Any approval that would breach one is blocked and escalated
rather than approved through.

The page shows committed daily budget from active campaigns beside the ceiling,
because a ceiling typed without knowing current spend is a guess — and the usual
way a guardrail fails is being set so high it never fires.

Owner-only: if the person who wants a big budget through can also lift the limit
that stops it, the limit is decoration.

---

## 8. Verify — do not skip this

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
- **Paid clients**: run the `collector_runs` query in §6. The attention rail
  cannot tell you this one — a `skipped` ad collector looks identical to a
  client that simply does not run ads.
- **eCommerce only**: compare the Overview's 30-day revenue and order count
  against the client's own Shopify dashboard on "Last 30 days". Order count is
  the cleaner signal — it can't be explained away by refunds or valuation
  differences. If they disagree, stop and find out why before the client sees it.

Once numbers reconcile, revenue reconciliation takes over automatically and
alerts if they ever drift again.

---

## 9. Read the first daily brief before adding the webhook

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
| Paid tab empty, nothing in the attention rail | No `ad_platform_accounts` row (§6). The collector recorded `skipped`, which nothing surfaces. Check `collector_runs`, not the dashboard. |
| Meta collects for one client but not another | The `META_ACCESS_TOKEN` system user isn't on that account's Business Manager. Per-account, not per-portfolio. |
| Google Ads collects nothing | Account not linked under MCC 711-022-5227, or `external_id` written with dashes — customer IDs are digits only. |
| Revenue block blank on a lead-gen client | Correct behaviour, not a bug — `revenueMode()` returns `leads_pending`. Calls stay untracked until plan §10 decision 0. |

---

## What is NOT self-serve

These need Tom (external accounts — see `CLAUDE.md`'s escalation list):

- Any new Vercel env var, and the **redeploy** after it (env changes don't reach
  an already-built deployment)
- Migrations — serialized, run in order, staging first
- Generating platform tokens, and the Slack app/channel per client
