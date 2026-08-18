# Onboarding runbook — arX Display (`arxdisplay.com`)

Companion to `docs/sop-client-onboarding.md`. That document is the general
procedure; this one is the filled-in instance, with every value that could be
verified already verified, and every value that could not marked as needing an
answer.

**Why this client is worth doing carefully:** arX is the first client whose
engagement is *paid-led* and whose business has **no online revenue**. Both
facts land outside what the platform currently models, and the general SOP has
no paid-connection step at all. What is learned here goes back into the SOP.

_Facts below were read from the live Meta and Google Ads APIs and the public
site on 2026-08-18. Everything marked ❓ needs Tom._

---

## 1. What arX Display is

| | |
|---|---|
| Business | Custom retail displays and store fixtures — design, engineering, prototyping, production management |
| Customers | **B2B.** Brand managers and program leads at national brands (Belkin, Dior, Estée Lauder, Kubota, Lowe's, Lutron) |
| Conversion | **Lead generation** — phone `855-279-3477`, email, contact form. No cart, no online purchase |
| Geography | **National / global.** Fulfillment in Fort Worth, Atlanta, St. Louis; rollouts across 21 countries. "By appointment · Nationwide" |
| Site platform | **WordPress** — running the `trusted-marketing` theme, so it is a TM build |
| Sales cycle | Long. A display program is a considered, multi-month purchase, not a same-week conversion |

The last row is the one that shapes every measurement decision below.

---

## 2. The client row — `/admin`

| Field | Value | Note |
|---|---|---|
| Name | `arX Display` | |
| Domain | `arxdisplay.com` | bare, lowercase |
| Tier | ❓ | Consistency · Momentum · Dominate · **Project**. Given a paid-led launch, `Project` may be the honest answer — ask before defaulting to a retainer rung |
| Client type | **`hybrid`** | ⚠️ A deliberate compromise — see §3 |
| Location code | `2840` | **Correct here.** 2840 is the whole United States, which is the SOP's classic mistake for a *local* client and exactly right for a national one. Do not "fix" it |
| Store platform | *leave null* | Not eCommerce |
| GSC property | ❓ | Exact form matters: `sc-domain:arxdisplay.com` for a Domain property, `https://arxdisplay.com/` **with the trailing slash** for URL-prefix |
| GA4 property ID | ❓ | Digits only. Verify the digits against GA4 → Admin → Property Settings **before** assuming any later error is permissions — that mistake cost six days on Salty Dog |

---

## 3. Client type: none of the three options is right

`CLIENT_TYPES` is `local_service | national_ecom | hybrid`
(`src/lib/clientProfile.ts`). arX is **national B2B lead-gen**, which is none of
them. The choice is not cosmetic — `client_type` drives two things
(`src/lib/workspaceTabs.ts`):

| Choice | Revenue block becomes | Extra tabs | Verdict |
|---|---|---|---|
| `national_ecom` | `shopify` — expects a store that does not exist | none | **Wrong.** Promises revenue it can never show |
| `local_service` | `leads_pending` — honest blank | GBP, Automation | Wrong on the facts; arX is not local |
| `hybrid` | `leads_pending` — honest blank | GBP, Automation | **Least wrong — use this** |
| *null* | `unknown` | none | Leaves an "Unclassified" badge and decides nothing |

**Use `hybrid`.** It buys the correct revenue behaviour — an honest "leads
pending" state instead of a revenue hero with nothing behind it. The price is
two irrelevant tabs, and that price is low: GBP renders `not_connected` and
Automation renders `being_built`, so both are already holding states rather than
empty numbers.

**The real fix is a fourth type, `national_lead_gen`** — `isLocal()` false, GBP
and Automation off, revenue mode `leads_pending`. That is a small change to
`workspaceTabs.ts` plus a value in `CLIENT_TYPES`; no migration, since
`clients.client_type` is plain text. Not done here because it is a code change,
not an onboarding step. Recorded in `STATUS.md`.

---

## 4. ⚑ Connect the ad accounts — the step the SOP was missing

**Both accounts exist and are live. Neither is connected to Growth OS.** Until
the rows below exist, `collectMetaAds` and `collectGoogleAds` return `0` and
record a `skipped` run — **and nothing anywhere surfaces a skipped run.** The
attention rail only selects `status = 'error'`
(`failingModules`, `src/lib/collectorHealth.ts:54`), and the client's freshness
stamp is satisfied by its organic collectors, so the paid tab is simply empty
and the portfolio looks healthy. For a paid-led client that is the whole
engagement, invisible.

### Verified live, 2026-08-18

**Meta** — `act_1761764321488072`, ACTIVE, $309.91 lifetime spend, account 13 days old.

| Campaign | Objective | Live since |
|---|---|---|
| `Remarketing \| arX 2026 \| TM` | `OUTCOME_LEADS` | 2026-08-06 |
| `Awareness \| arX 2026 \| TM` | `OUTCOME_TRAFFIC` | 2026-08-05 |

**Google Ads** — customer `7598077939`, **already linked under MCC 711-022-5227**.
(Worth noting: this is the step still outstanding for Salty Dog. arX arrives with
it done.)

| Campaign | Type | Daily budget |
|---|---|---|
| `Search Custom Retail Displays \| arX 2026 \| TM` | Search | $18.67 |
| `Search Display Solutions \| arX 2026 \| TM` | Search | $5.33 |
| `Search Branded \| arX 2026 \| TM` | Search | $2.67 |
| | **Total** | **$26.67/day ≈ $811/mo** |

**Microsoft Ads** — no arX account found. Skip the row rather than inserting a placeholder.

### The insert

There is no UI for this. `ad_platform_accounts` is read by all three collectors
and written by nothing in `src/` — only `supabase/seed.sql` and hand-written SQL.
Run after the client row exists:

```sql
insert into ad_platform_accounts (client_id, platform, external_id, auth_ref)
select id, 'meta', 'act_1761764321488072', null
from clients where domain = 'arxdisplay.com';

insert into ad_platform_accounts (client_id, platform, external_id, auth_ref)
select id, 'google_ads', '7598077939', null
from clients where domain = 'arxdisplay.com';
```

Two things about `auth_ref`:

- **Google Ads: `null` is correct.** Credentials are portfolio-level — the OAuth
  bundle (`google_ads_oauth`) and developer token (`google_ads_developer_token`)
  are vaulted once and the MCC comes from `GOOGLE_ADS_LOGIN_CUSTOMER_ID`. The
  per-client part is only the customer ID in `external_id`.
- **Meta: `null` falls back to the `META_ACCESS_TOKEN` system-user token.**
  ⚠️ **Verify rather than assume.** A system-user token is scoped to the Business
  Manager that issued it. Salty Dog collecting fine proves that token works for
  *Salty Dog's* account, not for arX's — the arX account is 13 days old and may
  sit in a different BM. If it does, mint a scoped token, vault it, and point
  `auth_ref` at it.

**One row per client per platform.** All three collectors resolve the account
with `.maybeSingle()`, which errors when a client has two rows for one platform.
A second Meta account for arX cannot be added by inserting another row.

### Verify — there is no ops endpoint for this

`ga4-check`, `shopify-check`, `wordpress-check` and `postflow-check` all exist.
**There is no `meta-check` or `google-ads-check`** — the two connections whose
failure mode is silent are the two with no verifier. Until one exists, verify in
SQL after the next collection:

```sql
select module, status, detail, error, started_at
from collector_runs
where client_id = (select id from clients where domain = 'arxdisplay.com')
  and module in ('meta_ads','google_ads')
order by started_at desc limit 10;
```

`status = 'skipped'` with `detail` naming a missing row or missing token means it
is **not** connected, however healthy the dashboard looks. Then confirm rows
landed:

```sql
select platform, count(*) rows, min(date) from_date, max(date) to_date,
       round(sum(spend)::numeric, 2) spend
from ad_metrics_daily
where client_id = (select id from clients where domain = 'arxdisplay.com')
group by platform;
```

Meta spend should reconcile against $309.91 lifetime in Ads Manager (the
collector pulls 28 days, and the account is only 13 days old, so for now those
figures should agree almost exactly — a rare clean check, and it expires once
the account passes 28 days).

---

## 5. ⚑ Spend guardrails — before any campaign work

`/dashboard/[id]/paid/guardrails`, owner-only. Committed daily budget today:

| Platform | Committed | Suggested daily ceiling | Suggested monthly |
|---|---|---|---|
| Google Ads | $26.67 | ❓ ~$40 | ❓ ~$1,200 |
| Meta | ❓ (adset-level, not read here) | ❓ ~$25 | ❓ ~$750 |

Ceilings are Tom's call — the numbers above are a starting point sized to leave
real headroom over committed spend while still being *reachable*. The usual way a
guardrail fails is being set so high it never fires. Set them before campaign
work, not after: the guard blocks and escalates writes that would breach it, so
its value is entirely in existing beforehand.

---

## 6. The measurement problem — state it before the client sees the dashboard

**MER is uncomputable for arX and always will be.** MER is revenue ÷ ad spend;
there is no online revenue. The Overview hero, the portfolio roll-up's revenue
column and revenue reconciliation are all eCommerce machinery, and `hybrid`
correctly parks the revenue block in `leads_pending` rather than faking it.

So what *is* the goal metric? Today the platform can honestly show:

- **Spend, impressions, clicks, CPC, CTR** per campaign — real from day one
- **Conversions from GA4** — only if key events for form submits are configured
  ❓. Worth checking during setup, not after the first empty report
- **Google Ads conversions** — whatever conversion actions are configured in the
  account ❓
- **Form fills and calls** — form fills are reachable through GA4;
  **calls are not tracked at all**

That last one is **plan §10 decision 0 (call tracking) surfacing for the fifth
time**, and arX makes the case sharper than the local-service clients did: a
B2B display program starts with a phone call to `855-279-3477` off a
brand-manager's desk, and that call is currently invisible to every part of this
platform. Decide it or state plainly that arX's paid reporting stops at
form-attributed leads.

**Do not let the long sales cycle be discovered later.** A display program takes
months to close, so any "cost per lead" figure will look alarming next to a
deal value that arrives two quarters later. Agree with arX up front what the
reported number means — cost per *qualified inbound*, not cost per sale — before
the first report goes out, not in response to it.

---

## 7. Organic, WordPress, and the rest

Follow the general SOP from here. The arX-specific notes:

- **WordPress adapter applies.** arX runs the `trusted-marketing` theme, so the
  standard path: a dedicated `TMAI` **Editor** account (not administrator — the
  first Alpha Zeta connection used an owner admin account with `edit_plugins`
  and `edit_users` for an integration that only edits page content), plus
  `wordpress-mu-plugins/tm-growth-os-seo-rest.php` so Rank Math's SEO fields are
  visible to REST. Verify with `/api/ops/wordpress-check?client=<id>` —
  `can_write: true` and `seo_fields_writable: true`.
- **Google access first, keywords after.** `Suggest keywords` merges GSC top
  queries with DataForSEO's ranked keywords; run it before Search Console is
  connected and you get the weaker DataForSEO half only.
- **Prompts for a B2B buyer**, not a consumer — "who makes custom retail
  displays for national rollouts", not "what is a display". Each prompt is a
  billed AI check per provider per run.
- **Slack webhook last**, after reading arX's section in a real daily brief.
  Once it is set, the content goes to the client unreviewed.

---

## 8. Order of operations

Owner-only steps marked ⚑.

1. Confirm tier and the measurement agreement in §6 ⚑
2. Create the client in `/admin` — `hybrid`, `2840`, no store platform
3. Grant the service account GA4 Viewer + GSC **Full user**, then paste both IDs into Settings
4. `/api/ops/ga4-check?client=<id>` — confirm the property ID digits before trusting any error
5. ⚑ Insert both `ad_platform_accounts` rows (§4)
6. ⚑ Connect WordPress — TMAI Editor account + mu-plugin, verify with `wordpress-check`
7. ⚑ Set spend guardrails (§5)
8. GSC backfill → suggest keywords → add keywords → add prompts
9. Trigger a collection, then run **both** SQL checks in §4 — this is the step that catches a silent paid failure
10. Read the first daily brief, then add the Slack webhook ⚑

Steps 5 and 9 are the ones this runbook exists for. Everything else the general
SOP already covered.
