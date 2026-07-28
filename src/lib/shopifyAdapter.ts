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
  | "page_title"                 // the page NAME — renders as the H1
  | "page_seo_title"             // the <title> tag — search results only
  | "page_meta_description"
  | "page_body"
  | "article_title"
  | "article_seo_title"
  | "article_meta_description";

/**
 * Human labels, in Shopify's OWN words.
 *
 * Shopify has two fields both called "title" and they are not the same thing:
 * `Page.title` is the page name (rendered as the H1), while the SEO title is a
 * `global.title_tag` metafield shown only in search results. Verified on a live
 * page 2026-07-28 — changing the SEO title correctly left the page heading
 * untouched, which looked like a bug because our label said "page seo title".
 *
 * A card that changes one and reads like the other is a trap, so the label says
 * exactly what the merchant will see change in their admin.
 */
export const CHANGE_LABEL: Record<ShopifyChangeType, string> = {
  page_title:               "Page title (the heading on the page)",
  page_seo_title:           "Search engine listing title (search results only)",
  page_meta_description:    "Search engine listing description",
  page_body:                "Page content",
  article_title:            "Article title (the heading on the post)",
  article_seo_title:        "Article search listing title (search results only)",
  article_meta_description: "Article search listing description",
};

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

// ── How Shopify actually stores page/article SEO ─────────────────────────────
//
// Verified against the live Admin API (2026-07-28): `Page` and `Article` have
// NO `seo` field. Products and Collections do, which is the trap — the obvious
// query compiles in your head and is rejected by the server.
//
// Page and Article SEO overrides live in metafields under the `global`
// namespace: `title_tag` and `description_tag`. That is a long-standing Shopify
// convention rather than something discoverable from the type itself.
type FieldKind =
  | { kind: "metafield"; key: "title_tag" | "description_tag"; type: string }
  | { kind: "native"; field: "body" | "title" };

const FIELD_FOR: Record<ShopifyChangeType, FieldKind> = {
  page_title:                { kind: "native",    field: "title" },
  page_seo_title:            { kind: "metafield", key: "title_tag",       type: "single_line_text_field" },
  page_meta_description:     { kind: "metafield", key: "description_tag", type: "multi_line_text_field" },
  page_body:                 { kind: "native",    field: "body" },
  article_title:             { kind: "native",    field: "title" },
  article_seo_title:         { kind: "metafield", key: "title_tag",       type: "single_line_text_field" },
  article_meta_description:  { kind: "metafield", key: "description_tag", type: "multi_line_text_field" },
};

const SEO_NAMESPACE = "global";

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
      current: `mock current value for ${change.type}`,
      targetLabel: "Mock page",
      stagedAt: new Date().toISOString(),
    };
  }

  const field = FIELD_FOR[change.type];

  type Node = {
    title?: string;
    handle?: string;
    body?: string;
    titleTag?: { value?: string } | null;
    descriptionTag?: { value?: string } | null;
  };

  // Both metafields are fetched regardless of which one we are changing: the
  // extra field is free, and it means the card can show the whole SEO picture
  // rather than one value in isolation.
  const SEO_FIELDS = `
    title handle body
    titleTag:       metafield(namespace: "${SEO_NAMESPACE}", key: "title_tag")       { value }
    descriptionTag: metafield(namespace: "${SEO_NAMESPACE}", key: "description_tag") { value }
  `;

  const data = await gql<{ node: Node | null }>(
    shopDomain, token,
    `query($id: ID!) {
       node(id: $id) {
         ... on Page    { ${SEO_FIELDS} }
         ... on Article { ${SEO_FIELDS} }
       }
     }`,
    { id: change.targetGid }
  );

  if (!data.node) throw new Error(`Shopify target not found: ${change.targetGid}`);

  // An unset SEO metafield reads as empty, which is correct: Shopify falls back
  // to the page title at render time, but the OVERRIDE genuinely has no value.
  // Recording the fallback as the "before" would make the ledger claim we
  // changed something that was never set.
  const current =
    field.kind === "native"
      ? (field.field === "title" ? (data.node.title ?? "") : (data.node.body ?? ""))
      : field.key === "title_tag"
        ? (data.node.titleTag?.value ?? "")
        : (data.node.descriptionTag?.value ?? "");

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

  // PageUpdateInput / ArticleUpdateInput accept a metafields list, so the SEO
  // override is written through the same mutation as native fields. `type` is
  // supplied because it is required when the metafield does not yet exist, and
  // on a page whose SEO has never been edited it will not.
  // Note: changing `title` does NOT change the handle, so existing URLs and any
  // links to them survive. Shopify only regenerates a handle when one is passed
  // explicitly, which we never do.
  const input: Record<string, unknown> =
    field.kind === "native"
      ? (field.field === "title" ? { title: value } : { body: value })
      : {
          metafields: [
            { namespace: SEO_NAMESPACE, key: field.key, value, type: field.type },
          ],
        };

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
