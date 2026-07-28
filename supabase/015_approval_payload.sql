-- 015_approval_payload.sql
-- WO-003 Stream D/E-S
--
-- The staged change itself. Because Shopify has no staging environment for
-- content, the proposed change lives HERE until a human approves it — this
-- column is that staging area (see lib/shopifyAdapter.ts).
--
-- Shape (adapter-agnostic, so the WordPress adapter uses the same column):
--   {
--     "adapter":     "shopify" | "wordpress",
--     "changeType":  "page_seo_title" | …,
--     "targetGid":   "gid://shopify/Page/123",
--     "targetLabel": "How SaltyDog Salt Remover Works",
--     "before":      "…",        -- live value at stage time
--     "after":       "…",        -- what we intend to write
--     "serpKind":    "title" | "description" | null
--   }
--
-- `before` is stored rather than re-read at publish time on purpose: it is the
-- value the recommendation was reasoning about. Re-reading would silently absorb
-- any drift in between and make the ledger claim a change we did not make.

begin;

alter table public.approvals
  add column if not exists payload jsonb,
  -- Set when the change is executed, so the ledger and the card agree on what
  -- actually landed rather than on what was proposed.
  add column if not exists published_at timestamptz,
  add column if not exists attempt int not null default 0;

create index if not exists approvals_adapter_idx
  on public.approvals ((payload ->> 'adapter'));

commit;
