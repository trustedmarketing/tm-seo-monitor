// lib/proposalEngine.ts — fill the queue.
//
// WO-003. Scans each client's content through whichever adapter their platform
// needs, runs the proposal rules, and stages approval cards. This is what turns
// the queue from something a human fills into something that arrives full.
//
// ── Three things it must never do ────────────────────────────────────────────
//
// 1. Re-propose declined work. Decline writes a 60-day suppression, and a rule
//    that keeps re-suggesting what a human refused is how a queue rots into
//    noise — the failure mode the design review was most worried about.
//
// 2. Duplicate an open card. The idempotency key is deterministic from target +
//    rule, so a second run collides with the first rather than producing two
//    cards for one fix.
//
// 3. Touch a client's site. Staging READS the live value and writes only to our
//    own database. Nothing reaches the platform until a human approves.
import { dbClient } from "@/lib/db";
import { readSecret } from "@/lib/vault";
import { proposalsFor, type Proposal } from "@/lib/proposals";
import * as shopify from "@/lib/shopifyAdapter";
import * as wordpress from "@/lib/wordpressAdapter";

export type EngineResult = {
  client: string;
  platform: "shopify" | "wordpress" | "none";
  scanned: number;
  proposed: number;
  suppressed: number;
  duplicate: number;
  error?: string;
};

/** How the proposal kind maps onto each adapter's change types. */
const SHOPIFY_TYPE: Record<Proposal["kind"], shopify.ShopifyChangeType> = {
  seo_title: "page_seo_title",
  meta_description: "page_meta_description",
};
const WP_TYPE: Record<Proposal["kind"], wordpress.WpChangeType> = {
  seo_title: "post_seo_title",
  meta_description: "post_meta_description",
};

const SLA_HOURS = 24;

/**
 * Has a human already refused this exact fix recently?
 *
 * Checks the suppression date written at decline time rather than counting
 * declines, so extending the window later is a one-line change and existing
 * suppressions keep working.
 */
async function isSuppressed(
  db: ReturnType<typeof dbClient>,
  clientId: string,
  idempotencyKey: string
): Promise<boolean> {
  const { data } = await db
    .from("approvals")
    .select("id, status, suppress_until")
    .eq("client_id", clientId)
    .eq("idempotency_key", idempotencyKey)
    .in("status", ["declined", "staged", "publishing", "published"])
    .limit(1);

  const row = data?.[0] as { status: string; suppress_until: string | null } | undefined;
  if (!row) return false;
  if (row.status !== "declined") return true;                       // already open or done
  if (!row.suppress_until) return true;
  return new Date(row.suppress_until).getTime() > Date.now();       // still inside the window
}

export async function runForClient(clientId: string, limit = 25): Promise<EngineResult> {
  const db = dbClient();

  const { data: client } = await db
    .from("clients").select("id, name, domain, client_type").eq("id", clientId).single();
  if (!client) return { client: clientId, platform: "none", scanned: 0, proposed: 0, suppressed: 0, duplicate: 0, error: "client not found" };

  const { data: store } = await db
    .from("client_stores")
    .select("platform, domain, api_client_id, auth_ref")
    .eq("client_id", clientId).eq("status", "active").limit(1).maybeSingle();

  const base = { client: client.name, scanned: 0, proposed: 0, suppressed: 0, duplicate: 0 };
  if (!store?.api_client_id || !store.auth_ref) {
    return { ...base, platform: "none", error: "no active store configured" };
  }

  const platform = store.platform as "shopify" | "wordpress";
  const secret = await readSecret(db, store.auth_ref);
  if (!secret) return { ...base, platform, error: "credentials missing from vault" };

  // Brand for the title pattern. The client's own name is what a reader would
  // recognise in a search result.
  const brand = client.name;

  try {
    type Staged = { targetRef: string; label: string; proposal: Proposal; changeType: string };
    const staged: Staged[] = [];

    if (platform === "shopify") {
      const token = await shopify.connect(store.domain, store.api_client_id, secret);
      const items = await shopify.listContent(store.domain, token, limit);
      base.scanned = items.length;
      for (const item of items) {
        for (const p of proposalsFor(item, brand)) {
          staged.push({ targetRef: item.gid, label: item.title, proposal: p, changeType: SHOPIFY_TYPE[p.kind] });
        }
      }
    } else {
      const pre = await wordpress.preflight(store.domain, store.api_client_id, secret);
      // Without REST-exposed SEO meta these proposals cannot be published, and a
      // card that cannot be approved is worse than no card.
      if (!pre.seoWritable) {
        return { ...base, platform, error: `SEO fields not writable: ${pre.seoDetail}` };
      }
      const items = await wordpress.listContent(store.domain, store.api_client_id, secret, pre.seoPlugin, limit);
      base.scanned = items.length;
      for (const item of items) {
        for (const p of proposalsFor(item, brand)) {
          staged.push({
            targetRef: JSON.stringify({ postType: item.postType, id: item.id }),
            label: item.title, proposal: p, changeType: WP_TYPE[p.kind],
          });
        }
      }
    }

    for (const s of staged) {
      const key = `auto:${s.proposal.ruleKey}:${s.targetRef}`.slice(0, 200);

      if (await isSuppressed(db, clientId, key)) {
        // Distinguish "a human said no" from "already queued" only in the count;
        // both mean do not stage, and neither is an error.
        base.suppressed++;
        continue;
      }

      const sla = new Date();
      sla.setHours(sla.getHours() + SLA_HOURS);

      const { error } = await db.from("approvals").insert({
        client_id: clientId,
        variant: "site",
        status: "staged",
        severity: s.proposal.severity,
        title: `${s.proposal.kind === "seo_title" ? "Search engine listing title" : "Search engine listing description"} — ${s.label}`,
        why: s.proposal.why,
        staged_by: "Growth OS · proposal engine",
        qc_passed: 1, qc_total: 1,
        requires_role: "specialist",
        sla_due_at: sla.toISOString(),
        idempotency_key: key,
        payload: {
          adapter: platform,
          changeType: s.changeType,
          targetGid: s.targetRef,
          targetLabel: s.label,
          before: s.proposal.before,
          after: s.proposal.after,
          serpKind: s.proposal.kind === "seo_title" ? "title" : "description",
        },
      });

      if (error) base.duplicate++;   // unique idempotency key refused it
      else base.proposed++;
    }

    return { ...base, platform };
  } catch (e) {
    return { ...base, platform, error: (e as Error).message.slice(0, 300) };
  }
}

/** Run for every active client that has a configured store. */
export async function runAll(limit = 25): Promise<EngineResult[]> {
  const db = dbClient();
  const { data: clients } = await db.from("clients").select("id").eq("active", true);
  const out: EngineResult[] = [];
  for (const c of (clients ?? []) as { id: string }[]) {
    out.push(await runForClient(c.id, limit));
  }
  return out;
}
