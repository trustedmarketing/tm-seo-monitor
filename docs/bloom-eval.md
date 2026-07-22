# Bloom (trybloom.ai) — Module D generation-engine evaluation

**Status:** IN PROGRESS · started 2026-07-22 · decision due by 2026-07-29 · Owner: CTO
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

## Preliminary posture (pre-spike) — leaning ADOPT-FOR-SUBSET
Strong structural fit (Claude Code MCP; learn-from-URL kills the per-client Figma template build; cheap;
you own outputs; lock-in solvable). **Gating unknowns before a final call:** (a) real brand fidelity vs tokens
(eye test), (b) 4:5 support, (c) **written** agency-use + no-training + DPA answers from Bloom, (d) IP-risk gate.
**Final recommendation** (adopt / adopt-for-subset / pass) lands after the spike (§1–2) + Bloom's written answers.

## Sources
- https://www.trybloom.ai/ · /pricing/ · /terms/ · /privacy/ · /developers/ · /docs/api · /docs/mcp/getting-started
- https://stackviv.ai/ai-tools/trybloom (third-party review)
