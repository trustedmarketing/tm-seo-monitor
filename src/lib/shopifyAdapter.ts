// lib/shopifyAdapter.ts — the Shopify execution adapter.
//
// WO-003 Stream E-S. The first of two execution adapters: every TM eCommerce
// build is Shopify, every other build is WordPress, so which adapter a client
// needs is derivable from `client_type` rather than configured per client.
//
// ── Why there is no "staging environment" here ────────────────────────────────
// WP Engine gives you a staging site; Shopify does not, for content. So the
// staging model inverts: **the proposed change lives in OUR database until
// approved**, not on the platform. The approval card holds the new value, the
// live value is read at stage time as the "before", and nothing touches the
// store until a human says yes.
//
// That is stronger than a staging site, not weaker: there is no staged state on
// the client's property that could be forgotten, drift, or be published by
// accident.
//
// ── Why this change class needs no screenshots ────────────────────────────────
// Shopify blocks the capture service (verified: getsaltydog.com returns 429
// after three attempts with backoff, while other hosts capture fine), and every
// ecom client is Shopify — so the visual before/after fails across the whole
// eCommerce book. For CONTENT changes that turns out not to matter: a title tag
// or meta description change is best evidenced by the exact text before and
// after, not by a picture of a page where the change is invisible anyway.
//
// The text diff IS the evidence for this class. Screenshots remain necessary for
// layout and theme changes, which is a later change class and a separate problem.
//
// ── Scopes ───────────────────────────────────────────────────────────────────
// Reads run on the existing collector app. Writes need `write_content` on the
// custom app per store. Read access proves nothing about write access, so
// `preflight()` checks the write scope explicitly rather than discovering it
// mid-publish.
import { mintToken } from "@/lib/shopify";
import { mockApis } from "@/lib/apiMock";

const API_VERSION = "2025-01";

/** Change classes this adapter can execute. Deliberately narrow to start. */
export type ShopifyChangeType =
  | "page_seo_title"
  | "page_meta_description"
  | "page_body"
  | "article_seo_title"
  | "article_meta_description";

export type ShopifyChange = {
  type: ShopifyChangeType;
  /** Shopify GID, e.g. gid://shopify/Page/123456. */
  targetGid: string;
  /** The value we intend to write. */
  proposed: string;
};

export type StagedChange = ShopifyChange & {
  /** The live value at stage time. This is the "before" in the ledger. */
  current: string;
  stagedAt: string;
  /** Human-readable target, for the card. */
  targetLabel: string;
};

export type PublishResult = {
  ok: boolean;
  dryRun: boolean;
  before: string;
  after: string;
  /** Everything needed to reverse this exact change. */
  revert: { targetGid: string; type: ShopifyChangeType; value: string };
  detail?: string;
};

type GQLResponse<T> = { data?: T; errors?: { message: string }[] };

async function gql<T>(shopDomain: string, token: string, query: string, variables: unknown): Promise<T> {
  const res = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify request failed: ${res.status} ${res.statusText}`);

  const body = (await res.json()) as GQLResponse<T>;
  if (body.errors?.length) {
    throw new Error(`Shopify GraphQL error: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  if (!body.data) throw new Error("Shopify returned no data");
  return body.data;
}

/**
 * Confirm the app can actually write before anything is staged for approval.
 *
 * Discovering a missing scope at publish time means a human already approved a
 * change we cannot make — the card says published, the store disagrees, and the
 * ledger records a lie. Cheaper to fail here.
 */
export async function preflight(shopDomain: string, token: string): Promise<{ canWrite: boolean; scopes: string[] }> {
  if (mockApis()) return { canWrite: true, scopes: ["read_orders", "write_content"] };

  const data = await gql<{ currentAppInstallation: { accessScopes: { handle: string }[] } }>(
    shopDomain, token,
    `query { currentAppInstallation { accessScopes { handle } } }`, {}
  );
  const scopes = data.currentAppInstallation.accessScopes.map((s) => s.handle);
  return { canWrite: scopes.includes("write_content"), scopes };
}

const FIELD_FOR: Record<ShopifyChangeType, "seo.title" | "seo.description" | "body"> = {
  page_seo_title: "seo.title",
  page_meta_description: "seo.description",
  page_body: "body",
  article_seo_title: "seo.title",
  article_meta_description: "seo.description",
};

/**
 * Read the live value and hold the proposed one. Touches nothing on the store.
 *
 * "Before" is captured at stage time rather than at publish time on purpose: it
 * is the value the recommendation was actually reasoning about. Re-reading at
 * publish would silently absorb any drift in between and make the ledger claim a
 * change we did not make.
 */
export async function stage(
  shopDomain: string,
  token: string,
  change: ShopifyChange
): Promise<StagedChange> {
  if (mockApis()) {
    return {
      ...change,
      current: `mock current value for ${FIELD_FOR[change.type]}`,
      targetLabel: "Mock page",
      stagedAt: new Date().toISOString(),
    };
  }

  const data = await gql<{ node: { title?: string; handle?: string; body?: string; seo?: { title?: string; description?: string } } | null }>(
    shopDomain, token,
    `query($id: ID!) {
       node(id: $id) {
         ... on Page    { title handle body seo { title description } }
         ... on Article { title handle body seo { title description } }
       }
     }`,
    { id: change.targetGid }
  );

  if (!data.node) throw new Error(`Shopify target not found: ${change.targetGid}`);

  const field = FIELD_FOR[change.type];
  const current =
    field === "body" ? (data.node.body ?? "")
    : field === "seo.title" ? (data.node.seo?.title ?? "")
    : (data.node.seo?.description ?? "");

  return {
    ...change,
    current,
    targetLabel: data.node.title ?? data.node.handle ?? change.targetGid,
    stagedAt: new Date().toISOString(),
  };
}

/**
 * Apply an approved change.
 *
 * `dryRun` is mandatory before any live client property (autonomy ladder #2) and
 * defaults to TRUE — writing to a client's store must be the deliberate choice,
 * never the default one a caller forgets to override.
 */
export async function publish(
  shopDomain: string,
  token: string,
  staged: StagedChange,
  opts: { dryRun?: boolean } = {}
): Promise<PublishResult> {
  const dryRun = opts.dryRun ?? true;

  const revert = { targetGid: staged.targetGid, type: staged.type, value: staged.current };
  const base = { before: staged.current, after: staged.proposed, revert };

  if (dryRun) {
    return { ok: true, dryRun: true, ...base, detail: "dry run — nothing written to the store" };
  }

  const { canWrite, scopes } = await preflight(shopDomain, token);
  if (!canWrite) {
    throw new Error(
      `Shopify app lacks write_content on ${shopDomain} (has: ${scopes.join(", ") || "none"}). ` +
      `Add the scope to the custom app before publishing.`
    );
  }

  await write(shopDomain, token, staged.targetGid, staged.type, staged.proposed);
  return { ok: true, dryRun: false, ...base };
}

/**
 * Reverse a published change.
 *
 * Punch list #1: this writes a SECOND ledger entry rather than erasing the
 * first. A change that ran for three days and was then reverted is data —
 * measurement depends on it, and hiding it would corrupt the verdict.
 */
export async function revert(
  shopDomain: string,
  token: string,
  r: PublishResult["revert"],
  opts: { dryRun?: boolean } = {}
): Promise<PublishResult> {
  const dryRun = opts.dryRun ?? true;
  const base = {
    before: "(current)",
    after: r.value,
    revert: { targetGid: r.targetGid, type: r.type, value: r.value },
  };
  if (dryRun) return { ok: true, dryRun: true, ...base, detail: "dry run — nothing reverted" };

  await write(shopDomain, token, r.targetGid, r.type, r.value);
  return { ok: true, dryRun: false, ...base };
}

async function write(
  shopDomain: string,
  token: string,
  gid: string,
  type: ShopifyChangeType,
  value: string
): Promise<void> {
  if (mockApis()) return;

  const isArticle = type.startsWith("article_");
  const field = FIELD_FOR[type];

  const input: Record<string, unknown> =
    field === "body" ? { body: value }
    : field === "seo.title" ? { seo: { title: value } }
    : { seo: { description: value } };

  const mutation = isArticle
    ? `mutation($id: ID!, $article: ArticleUpdateInput!) {
         articleUpdate(id: $id, article: $article) { userErrors { field message } }
       }`
    : `mutation($id: ID!, $page: PageUpdateInput!) {
         pageUpdate(id: $id, page: $page) { userErrors { field message } }
       }`;

  const data = await gql<{ pageUpdate?: { userErrors: { message: string }[] }; articleUpdate?: { userErrors: { message: string }[] } }>(
    shopDomain, token, mutation,
    isArticle ? { id: gid, article: input } : { id: gid, page: input }
  );

  // userErrors are Shopify's soft failures: HTTP 200 with the write refused.
  // Treating them as success is how a ledger ends up claiming a change that
  // never happened.
  const errs = [...(data.pageUpdate?.userErrors ?? []), ...(data.articleUpdate?.userErrors ?? [])];
  if (errs.length) throw new Error(`Shopify write refused: ${errs.map((e) => e.message).join("; ")}`);
}

/** Resolve a store's credentials and mint a short-lived token. */
export async function connect(
  shopDomain: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  return mintToken(shopDomain, clientId, clientSecret);
}
