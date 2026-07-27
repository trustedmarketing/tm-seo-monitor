# Bloom (trybloom.ai) — Module D generation-engine evaluation

**Status:** IN PROGRESS (paused on credits, per Tom) · started 2026-07-22 · decision due by 2026-07-29 · Owner: CTO
**Where it's parked:** pipeline proven end-to-end via REST; 6 Salty Dog samples in hand (all 3 sizes);
credits exhausted after ~7 gens (paid plan on hold). Remaining before the final call: (a) Tom's eye-test
read on the 6 samples, (b) Bloom's written answers to the terms email (agency-use / no-training / DPA / IP),
(c) optional — finish Salty Dog + full DAPS gallery once credits are topped up.
**Mandate:** evaluate Bloom as the *primary* generation engine for Module D volume ad
creative (demoting Figma to a precision tier). Recommendation at end: adopt / adopt-for-subset / pass.

All facts below verified from trybloom.ai on 2026-07-22 (see Sources). Nothing here is assumed.

## 0. What Bloom is (verified)
- "On-brand AI" for ad creative: onboard a brand by **website URL or Instagram handle** → it
  extracts colors, fonts, logos, visual style; then generates on-brand images from short prompts.
- Ships a **REST API and an MCP server built for Claude Code** (also Cursor/VS Code). MCP tools:
  `bloom_onboard_brand`, `bloom_generate_image`, `bloom_edit_image`, `bloom_resize_image`.
  Batch: "30 images in one message," parallel. API+MCP included in every plan.
- **Sizes confirmed via live API: 1:1, 4:5, 9:16** (4:5 delivered at 1632×2048), plus 16:9; smart-resize
  recomposes rather than crops. Our required set (1:1/4:5/9:16) is fully supported.
- MCP connector: `https://www.trybloom.ai/api/mcp` (Claude Settings → Connectors → add custom → Sign in with Bloom). Docs: `/docs/api`, `/docs/mcp/getting-started`.

## 1. API/MCP integration spike — ✅ RUNNING (via REST — the production path)
The Claude Code session couldn't see the MCP connector (session MCPs are fixed at startup), so the spike
runs on Bloom's **REST API** (`x-api-key`) from Claude Code — which is also exactly what the production
Module D cron will use (the automated pipeline can't call a session-bound connector). **Verified API shape:**
- Onboard: `POST /api/v1/brands {"url": ...}` → brand `id` + auto-extracted profile.
- Generate: `POST /api/v1/images/generations {"brandSessionId": <brand id>, "prompt", "aspectRatio"}` → image `id(s)`.
- Retrieve: `GET /api/v1/images/<id>?wait=true` → `imageUrl`, `width`/`height`.

Both brands **already onboarded + `ready`**: Salty Dog `75f3bffa…`, DAPS `55f569cd…` (DAPS.FIT). First image
generated clean (Salty Dog, 4:5, 1632×2048). Full **10/brand × 1:1/4:5/9:16** generating → gallery URLs to Tom
for the eye test; each record maps to the `creatives` shape (brand, prompt, format, `imageUrl`, source='bloom').
API key stored git-ignored; to be vaulted as the portfolio-level Bloom credential for the prod pipeline.

**Spike result (2026-07-22):** 6 Salty Dog creatives generated cleanly — 2 each at 1:1 (2048²), 4:5
(1632×2048), 9:16 (1152×2048), all correct dimensions. Then **HTTP 402 Payment Required** — the account's
credits were exhausted after ~7 generations, so the remaining Salty Dog briefs + the full DAPS set didn't run.
Gallery URLs handed to Tom for the eye test. **To finish the set + DAPS: top up the Bloom account** (trial
balance is nowhere near our volume — see §3). Pipeline itself: proven, zero failures on the generations that ran.

## 2. Brand-fidelity review — 🔄 IN PROGRESS
**Bloom's auto-extracted Salty Dog profile** (the fidelity reference): colors `#0B1C39` (navy), `#D9531E`
(orange), `#F5F3EC` (cream), `#1A1A1A`, `#FFFFFF`; fonts **Archivo, Manrope**; logo captured. (DAPS profile
pulled alongside its gallery.)
**Method:** compare Bloom's URL-learned palette/type/logo against each brand's *true* design tokens, flag
deviations; **Tom does the final eye test** on the generated gallery.
**Still needed:** Salty Dog + DAPS **official design tokens** to score against (the `tm-clients` files) — or I
cross-check against the live site. Bloom learns from the URL, so fidelity hinges on how well the public site
encodes the brand system; the navy/orange/cream + Archivo/Manrope extraction reads plausibly on-brand pending
the token comparison + eye test.

## 3. Pricing at our volume — ✅ preliminary
Verified tiers: **Plus $20/mo** (50 assets) · **Scale $90/mo** ($1,080/yr, ~28% off; 500 credits,
unlimited seats, pooled credits, shared brand workspaces, volume discounts) · **$5 3-day trial** ·
custom/volume via `support@trybloom.ai`. Credits: 2K image = 1, 4K = 2.

Our volume (13 clients × weekly, 10 creatives/brand/wk × 3 sizes):
- ≈ 30 assets/brand/wk → 13 brands ≈ **~1,680 2K assets/mo** (worst case: 1 credit per size).
- Scale's 500 credits/mo doesn't cover it → **volume/custom tier needed**. At Scale's implied ~$0.18/credit,
  ~1,680 assets ≈ **~$300/mo** before volume discount — trivial vs the platform's run-cost.
- ⚠️ Refine after the spike: does one `bloom_generate_image` yield all sizes, or is each size a credit,
  and is `bloom_resize_image` free? That swings the number 2–3×.
- **Data point from the spike:** each requested size is its own generation (its own credit), and the account
  hit a hard **402 after ~7 images** — confirming the trial/low tier is unusable at our volume. Real usage is
  clearly on the **Scale ($90/mo, 500 credits) or custom** tier; our ~1,680 assets/mo needs the volume quote.
- **vs Figma:** the Figma pipeline needs a **master ad-template component set built per client** (13 sets ×
  sizes) — large upfront design+eng effort plus maintenance as brands drift. Bloom's learn-from-URL
  **removes the per-client template build entirely.** On *build effort* Bloom wins decisively; on *run cost*
  both are cheap.

## 4. Terms & privacy — ✅ preliminary, with GATING FLAGS
**Ownership (good):** "You retain ownership of the brand assets generated through our service." Bloom keeps
only a limited store/process license.
**Gaps that gate adoption for client work:**
- ⚠️ **No explicit agency/client/resale clause.** The ToS is silent on using Bloom to generate creative for
  *clients'* brands and running it as paid ads. Not prohibited, not granted → **get written confirmation**
  from Bloom that agency-on-behalf-of-clients + paid advertising use is permitted.
- ⚠️ **Model-training not disclosed.** The privacy policy does not say whether uploaded/learned **brand assets
  train Bloom's or third-party models**, and offers no opt-out. For *client* brand assets that's a real
  confidentiality issue → require a **written no-training confirmation + DPA** before onboarding client brands.
- ⚠️ **No indemnity; outputs "as is."** Bloom disclaims trademark/IP liability → **we** bear IP risk on generated
  client creative; needs CLO sign-off + a mandatory human review gate before any launch.
- ⚠️ "Generated assets may not be unique — similar outputs may be generated for other users." Differentiation
  risk; the eye test + our creatives-table should watch for it.
- ⚠️ **Deletion is permanent, no export path mentioned** → lock-in risk, mitigated by §5.

## 5. Architecture & zero lock-in — ✅
Bloom sits **behind our own layer**, never as the system of record:
1. Recommendation → Claude drafts copy + brief (unchanged).
2. Generate via Bloom MCP (`bloom_onboard_brand` once/client; `bloom_generate_image` per brief × sizes).
3. **Every asset is persisted in our `creatives` table** — and **re-hosted into our Supabase Storage**, not
   left on Bloom. Columns: `client_id, platform, type, asset_url (ours), copy, brief/prompt, brand_ref,
   format, source='bloom', tags jsonb, first_seen`.
4. Upload to the ad platform **paused** → approval → launch date → **change ledger** → measurement attaches
   (Module F/G, unchanged).
**Zero lock-in:** Bloom is a **stateless generation call** behind a thin `generateCreative(brief, brand, sizes)`
interface + our `creatives` table. Swapping Bloom → Higgsfield/Figma/other is a driver change; pipeline,
storage, approval, ledger, and all IP/history are ours. Canonical design tokens live in *our* `tm-clients`
workspace (Bloom's URL-learned profile is a convenience, re-derivable). Figma remains the **precision tier**
behind the *same* interface.

## 6. Vendor answers received — 2026-07-27 (Ray, founder) ✅

Full written answers received, two days ahead of the decision deadline. Scored against the four
gates set in the preliminary posture:

| Gate | Answer | Verdict |
|---|---|---|
| **(c) Agency / client / resale use** | "Yes. You can use Bloom for client brands, run the assets as paid ads, and deliver them to those clients. No restrictions." | ✅ **CLEARED** — this was the largest flag; the ToS was silent |
| **(c) Ownership** | Retained by us; usable in paid ads and deliverable to clients with no further licence | ✅ CLEARED |
| **(c) Model training** | Bloom does not train on customer brand assets, prompts or outputs. Production runs on Google / OpenAI / Anthropic **commercial APIs**, which do not train on API data by default, and Bloom does not opt into sharing. No separate opt-out needed. | ✅ **CLEARED** — the privacy policy's silence was the flag; this answers it at the subprocessor level |
| **(c) DPA + subprocessors** | **None today.** "If these are required, we would need to put them in place before onboarding your client data." | ⚠️ **OPEN — negotiable, and they offered** |
| **Account isolation** | Workspace-isolated; not surfaced or reused across users. The "similar outputs" clause is only about generative systems independently producing similar results. | ✅ CLEARED |
| **(d) IP indemnification** | **None.** Assets provided as-is. | ⚠️ **OPEN — we carry the risk** |
| **Portability** | Export via API at any time; cancelling does not delete the account or data. **No fixed export window after deletion** — export before deleting. | ✅ CLEARED with a procedural caveat |
| **(b) 4:5 support** | Confirmed, plus 2:3, 3:2, 3:4, 4:3, 5:4, 16:9, 21:9 | ✅ **CLEARED** — was the last technical unknown |
| Limits / SLA | 120 req/min per key · 5 assets per generation batch · 10 files per upload · 100 records per page. **No contractual uptime SLA.** | ✅ Adequate — generation is not in a real-time path |

### Pricing — corrected, and one detail that changes the model

Scale at our volume: **2,000 credits/month · $340 month-to-month · $306/month billed annually**
($3,672/yr). Unit price ≈ **$0.17/credit**, unchanged from the earlier estimate.

⚠️ **The detail that matters: each aspect ratio is a separate billed asset.** One creative delivered
in 1:1, 4:5 and 9:16 costs **3 credits**, not 1. `bloom_resize_image` is priced the same. So the
planning unit is *assets*, not *concepts* — 2,000 credits is roughly **660 three-ratio concepts per
month**, not 2,000. That is still ample across the portfolio, but it is a 3× difference from the
naive read and it is how the plan should be budgeted.

### Recommendation — **ADOPT FOR SUBSET**, with two conditions

The posture holds and is now materially better supported: every technical and rights gate cleared,
including the two that were genuinely blocking (agency use, model training).

**Conditions before client data is onboarded:**

1. **Request the DPA + subprocessor list now.** Ray explicitly offered to put them in place. We are a
   processor acting for client brands, so this should be in hand before client assets are uploaded at
   volume — not after. It costs a request; the answer was pre-offered.
2. **Start month-to-month at $340, not the annual $3,672.** The annual saves $408/yr (~10%), which is
   not worth committing to before the generation spike (§1–2) is finished on a paid plan. Revisit at
   renewal once fidelity is proven on two real brands.

**Accepted risks, explicitly:**

- **No IP indemnity.** We carry trademark/IP exposure on generated assets. Mitigated structurally
  rather than contractually: every creative passes a human approval card before it can run as a paid
  ad (autonomy ladder — ad launches are *always* human-approved), and briefs should avoid referencing
  third-party marks. This is a real risk, not a cleared one, and it should be visible to whoever
  signs off on client contracts.
- **No uptime SLA.** Acceptable: creative generation is batch work with no real-time dependency, and
  a failed generation delays a card rather than breaking a client surface.
- **No fixed post-deletion export window.** Neutralised by the zero-lock-in architecture already in
  the plan: every asset is re-hosted into our own `creatives` table on generation, so our library
  never depends on Bloom retaining anything.

**Also take:** the offered shared Slack channel with their founder. Direct vendor access during
integration is worth more than an SLA at this stage.

**Still outstanding for a final adopt (not blocking the decision):** deliverable 2, brand fidelity —
6 sample creatives exist but credits ran out mid-spike. Finish it on the paid plan against Salty Dog
and one other brand before scaling beyond a subset.

## Preliminary posture (pre-spike) — leaning ADOPT-FOR-SUBSET
> **Superseded by §6 above (2026-07-27).** Kept for the record.

Strong structural fit (Claude Code MCP; learn-from-URL kills the per-client Figma template build; cheap;
you own outputs; lock-in solvable). **Gating unknowns before a final call:** (a) real brand fidelity vs tokens
(eye test), (b) 4:5 support, (c) **written** agency-use + no-training + DPA answers from Bloom, (d) IP-risk gate.
**Final recommendation** (adopt / adopt-for-subset / pass) lands after the spike (§1–2) + Bloom's written answers.

## Sources
- https://www.trybloom.ai/ · /pricing/ · /terms/ · /privacy/ · /developers/ · /docs/api · /docs/mcp/getting-started
- https://stackviv.ai/ai-tools/trybloom (third-party review)
