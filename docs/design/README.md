# Design export — map

Claude Design export of the Growth OS UI, committed 2026-07-27. **This is the
design source of truth for WO-003.** Read this file to orient; open the HTML
only for the screen you're actually building.

Reviews of this export live in `docs/design-review-punch-list.md` (10 items to
close before build) and `docs/feasibility-review-stack.md` (what's buildable
against the current stack).

---

## Files

| File | Size | What it is |
|---|---|---|
| `Growth OS.dc.html` | 162 KB | The whole app — 16 screens across both sides (agency + client portal) |
| `ApprovalCard.dc.html` | 23 KB | The atomic component: 4 variants × 8 states |
| `RecCard.dc.html` | 23 KB | Recommendation card: 5 variants × 6 states |
| `support.js` | 69 KB | Claude Design runtime. Not ours, don't port it |
| `_ds/…/` | — | Brand design system: `colors_and_type.css` (tokens), fonts, `styles.css` |
| `.thumbnail` | 7 KB | Preview image |

### Format

These are **Claude Design (`x-dc`) exports**, not plain HTML. Markup uses
`{{ binding }}`, `<sc-if value="…">`, and `<sc-for list="…">`; a
`<script type="text/x-dc">` block at the bottom of each file holds the state
machine and all sample data. Read that bottom script to understand behavior —
the markup above it is presentation only.

**Porting rule:** take the tokens from `_ds/…/colors_and_type.css` and the
layout/state logic from the export, but write real React. Do not port
`support.js` or the `sc-*` directives.

---

## `Growth OS.dc.html` — screens

State is `{ mode: 'agency' | 'portal', screen, wsTab }`. The sidebar switches
mode; `nav()` (~line 1549) defines the screen list per mode; `header()`
(~line 1556) holds every screen's title and subtitle copy.

### Agency side (`mode: 'agency'`)

| Screen key | Nav label | Covers |
|---|---|---|
| `portfolio` | Portfolio | Morning page. 13 clients × 5 channels, attention rail (declining metrics, failed QC, negative verdicts, stale approvals) |
| `approvals` | Approvals queue | The decision queue. Filter chips, bulk "approve all low-risk", earned empty state, median-decision-time stat |
| `workspace` | Client workspace | Per-client deep dive — 11 tabs, see below |
| `qc` | QC panel | Site score, open issues, scan history, "Run scan now" |
| `paid` | Paid controls | Inline pause/budget edits + the second-yes spend-exposure modal (`liveConfirm`) |
| `cardlab` | Approval Card lab | Every ApprovalCard variant and state on one page |
| `inventory` | Component inventory | 9 groups of primitives — the "this is a system" page |

**Client workspace tabs** (`wsTab`, ~line 1698): Overview · Organic · Paid ·
Social · GBP · AEO · Automation · Playbook · QC · Changes · Settings.
Settings holds the guardrails, the who-approves-what matrix, and muted rules.

### Client portal (`mode: 'portal'`)

| Screen key | Nav label | Covers |
|---|---|---|
| `home` | Home | "Is this working?" — 4 headline numbers, answered in a sentence |
| `playbook` | Playbook | 6 workstreams, 22 commitments, progress bars |
| `organic` | Organic | Conversion-relevant rankings, blog concepts awaiting input, published work + verdicts |
| `pPaid` | Paid | Spend, results, live creative gallery |
| `gbp` | Google Business | Calls, directions, views, reviews needing replies |
| `aeo` | AEO | "When someone asks AI about you" — prompt table, cited/mentioned/absent |
| `automation` | Automation | What runs in the background, with volumes |
| `pApprovals` | Approvals | The client's own queue |
| `mobile` | On mobile | 390×844 spec — 2×2 metrics, 44px targets, 32px serif numeral floor |

⚠️ **Two gaps to know about before you build from this file:**

1. A `results` screen exists in `header()` ("What we shipped") but is **not in
   the portal nav** — the change log in client language is specced but
   unreachable. Decide in WO-003 whether it's a nav item or folds into Organic.
2. The GBP, LinkedIn (inside `pPaid`), and Google Ads panels render as
   **populated with sample data**. Per the feasibility review those three are
   blocked on API applications — build them as "connection pending" states, not
   as the mockup shows.

---

## `ApprovalCard.dc.html`

The atomic unit. Everything in the agency side is arrangement around this.

- **Variants** (`card.variant`): `site` · `ad` · `creative` · `content`
- **States** (`card.status`): `default` · `expanded` · `publishing` ·
  `published` · `declining` · `declined` · plus two orthogonal modifiers,
  `blocked` (QC failed → approve locked, red rail) and `stale` (past SLA →
  amber rail, warm surface)
- **`warm` prop** swaps agency copy for client-facing copy
  ("Approve & publish" → "Looks good — go ahead")

Sub-components inside it: `checks` (QC list), `diff` (before/after text),
`creatives` (variant picker), `reasons` (decline dropdown).

**Missing state — punch list #2:** there is no `failed` state. Publish
failures (WP timeout, Meta rejects creative, deploy breaks) have no design.
That is a WO-003 deliverable, not an oversight to build around.

## `RecCard.dc.html`

The pre-approval recommendation, before work is staged.

- **Variants**: `titletag` · `blog` · `creative` · `social` · `aeo`
- **States**: `default` · `choose` (pick a variant) · `running` (stepper) ·
  `paused` · `done` · `declining` · `declined`

Decline writes a reason and a `suppressUntil` date — this is the 60-day
suppression the punch list flags as load-bearing.

---

## Sample-data caution

Client names in the export mix invented and plausible-real (Ridgeline HVAC,
Northstar Apparel, Harbor Dental, owner "Dana Reyes"). Punch-list smaller note:
standardize on obviously-fictional names before any of this is demoed.
