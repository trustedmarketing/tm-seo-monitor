# Growth OS — STATUS

_Last updated: 2026-07-22_

## Shipped to production
- **WO-001 enabling layer** — staging Supabase, vitest + `MOCK_APIS` harness, CI, branch/agent conventions.
- **Collectors** (per-client, vaulted, dynamic, into a shared spine): organic/SEO, AI visibility, **Meta ads**,
  **GA4 conversions**, **Shopify revenue**; **job queue + `collector_runs`** observability; **secrets vault**;
  **ClickUp sync**.
- **Module A — command dashboard** (`/command`): attention rail + per-client channel strip with the **MER
  reconciliation view** (actual revenue ÷ total ad spend, over-attribution flag).
- Two correctness bugs caught by the **accuracy gate** and fixed: Meta 6× conversion/revenue double-count;
  vault read/write via SECURITY DEFINER RPCs.

## Live on a real client
- **Salty Dog:** Shopify revenue automated in prod. Meta pending a durable token (system-user approval in
  flight). Full MER proven on staging (**1.86×**, Meta claims **93%** of actual revenue).

## In flight
- **Meta durable token** — system-user token, awaiting business co-admin approval.
- **Bloom (trybloom.ai) evaluation for Module D generation** — `docs/bloom-eval.md`. Deliverables 3 (pricing),
  4 (terms/privacy), 5 (architecture/zero-lock-in) drafted from verified sources; deliverables 1 (generation
  spike) and 2 (brand fidelity) **blocked** on a Bloom account + MCP connector and Salty Dog/DAPS design
  tokens. **Preliminary posture: adopt-for-subset**, pending the spike + written agency-use/no-training/DPA
  answers from Bloom. **Decision due 2026-07-29.**

## Next (unblocked, not started)
- Microsoft/Bing + Google Ads collectors (against fixtures; Google dev-token application is calendar-gated).
- Scale Shopify + Meta wiring across the remaining clients.
- `recSync`: stop auto-resolving human-**approved** recommendations (flagged bug).

## Pending Tom
- Meta system-user token (co-admin approval) → prod Meta wiring.
- Google Ads developer-token application (multi-week).
- **Bloom:** account + MCP connector authorization in this session · Salty Dog + DAPS design tokens · DAPS brand URL/IG.
- Approve `docs/CLAUDE-monitor-draft.md` as the root operating brief.
