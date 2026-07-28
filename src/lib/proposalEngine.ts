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
import type { ContentLike } from "@/lib/proposals";
import { readSecret } from "@/lib/vault";
import { proposalsFor, type Proposal } from "@/lib/proposals";
import { policyFor } from "@/lib/declinePolicy";
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

type Decision =
  | { act: "stage"; variant: 0 | 1; redraftOf?: string }
  | { act: "skip"; why: "open_or_done" | "suppressed" };

/**
 * What should happen to this proposal, given what a human has already said?
 *
 * This is where the decline reason stops being a stored string and starts
 * changing behaviour. Three distinct outcomes:
 *
 *   nothing said yet          → stage it
 *   still inside suppression  → stay quiet
 *   "wrong direction", window │ the INTENT was fine, the value was not. Offer a
 *   passed, no re-draft tried │ genuinely different angle, once.
 *
 * A rule that re-proposes the same string after a refusal is not learning, and
 * one that keeps generating alternatives forever is nagging. Hence exactly one
 * re-draft.
 */
async function decide(
  db: ReturnType<typeof dbClient>,
  clientId: string,
  baseKey: string,
  redraftKey: string
): Promise<Decision> {
  const { data } = await db
    .from("approvals")
    .select("id, status, suppress_until, decline_reason, idempotency_key")
    .eq("client_id", clientId)
    .in("idempotency_key", [baseKey, redraftKey])
    .in("status", ["declined", "staged", "publishing", "published"]);

  const rows = (data ?? []) as {
    id: string; status: string; suppress_until: string | null;
    decline_reason: string | null; idempotency_key: string;
  }[];

  if (rows.length === 0) return { act: "stage", variant: 0 };

  // Anything still open, or already published, means leave it alone.
  if (rows.some((r) => r.status !== "declined")) return { act: "skip", why: "open_or_done" };

  const redrafted = rows.find((r) => r.idempotency_key === redraftKey);
  const original  = rows.find((r) => r.idempotency_key === baseKey);

  // The re-draft was also refused. That is two humans-worth of "no" on this fix.
  if (redrafted) {
    const until = redrafted.suppress_until;
    if (!until || new Date(until).getTime() > Date.now()) return { act: "skip", why: "suppressed" };
    return { act: "skip", why: "suppressed" };
  }

  if (!original) return { act: "stage", variant: 0 };

  const stillSuppressed =
    !original.suppress_until || new Date(original.suppress_until).getTime() > Date.now();
  if (stillSuppressed) return { act: "skip", why: "suppressed" };

  // Window has passed. What comes back depends on WHY it was refused.
  const policy = policyFor(original.decline_reason ?? "other");
  return policy.redraft
    ? { act: "stage", variant: 1, redraftOf: original.id }
    : { act: "stage", variant: 0 };
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
    type Staged = { targetRef: string; label: string; proposal: Proposal; changeType: string; item: ContentLike };
    const staged: Staged[] = [];

    if (platform === "shopify") {
      const token = await shopify.connect(store.domain, store.api_client_id, secret);
      const items = await shopify.listContent(store.domain, token, limit);
      base.scanned = items.length;
      for (const item of items) {
        for (const p of proposalsFor(item, brand, 0)) {
          staged.push({ targetRef: item.gid, label: item.title, proposal: p, changeType: SHOPIFY_TYPE[p.kind], item });
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
        for (const p of proposalsFor(item, brand, 0)) {
          staged.push({
            targetRef: JSON.stringify({ postType: item.postType, id: item.id }),
            label: item.title, proposal: p, changeType: WP_TYPE[p.kind], item,
          });
        }
      }
    }

    for (const s of staged) {
      const baseKey    = `auto:${s.proposal.ruleKey}:${s.targetRef}`.slice(0, 200);
      const redraftKey = `${baseKey}:v2`.slice(0, 200);

      const decision = await decide(db, clientId, baseKey, redraftKey);
      if (decision.act === "skip") { base.suppressed++; continue; }

      // A re-draft is a genuinely different suggestion, not the same one retried.
      const proposal = decision.variant === 1
        ? proposalsFor(s.item, brand, 1).find((p) => p.kind === s.proposal.kind)
        : s.proposal;
      if (!proposal) { base.suppressed++; continue; }

      const key = decision.variant === 1 ? redraftKey : baseKey;

      const sla = new Date();
      sla.setHours(sla.getHours() + SLA_HOURS);

      const { error } = await db.from("approvals").insert({
        client_id: clientId,
        variant: "site",
        status: "staged",
        severity: proposal.severity,
        title: `${proposal.kind === "seo_title" ? "Search engine listing title" : "Search engine listing description"} — ${s.label}`,
        why: decision.variant === 1
          ? `${proposal.why} A previous suggestion was declined as the wrong direction, so this takes a different angle.`
          : proposal.why,
        staged_by: "Growth OS · proposal engine",
        qc_passed: 1, qc_total: 1,
        requires_role: "specialist",
        sla_due_at: sla.toISOString(),
        idempotency_key: key,
        redraft_of: decision.variant === 1 ? decision.redraftOf ?? null : null,
        payload: {
          adapter: platform,
          changeType: s.changeType,
          targetGid: s.targetRef,
          targetLabel: s.label,
          before: proposal.before,
          after: proposal.after,
          serpKind: proposal.kind === "seo_title" ? "title" : "description",
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
