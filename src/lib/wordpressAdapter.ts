// lib/wordpressAdapter.ts — the WordPress execution adapter.
//
// WO-003 Stream E-W. The second of two execution adapters. Every TM eCommerce
// build is Shopify and every other build is WordPress, so which adapter a client
// needs falls out of `client_type` rather than per-client configuration.
//
// ── Auth ─────────────────────────────────────────────────────────────────────
// WP application passwords over Basic auth. A per-site credential that can be
// revoked without touching a human's login, which is what makes it safe to hold
// on a client's behalf. Credentials live in `client_stores` with
// platform='wordpress': `api_client_id` holds the WP username, `auth_ref` points
// at the vaulted application password.
//
// ── Staging ──────────────────────────────────────────────────────────────────
// Same inversion as Shopify: the proposed change lives in OUR database until a
// human approves it, and the live value is read at stage time as the "before".
// WP Engine staging environments are for THEME work — code that can break a
// page — not for a meta description. Putting content changes through a deploy
// would make the highest-volume, lowest-risk class the most expensive one, and
// would break the 60-minute undo window.
//
// ── What is certain vs what is detected ──────────────────────────────────────
// Title, content and excerpt are core REST fields and always present. SEO title
// and description are NOT: they belong to whichever plugin the site runs, and
// are only writable if that plugin registers them for REST. So the adapter
// DETECTS capability rather than assuming it — the alternative is discovering a
// missing field mid-publish, after a human has approved a change we cannot make.
import { mockApis } from "@/lib/apiMock";

export type WpChangeType =
  | "post_title"
  | "post_content"
  | "post_excerpt"
  | "post_seo_title"
  | "post_meta_description";

export const WP_CHANGE_LABEL: Record<WpChangeType, string> = {
  post_title:            "Page title (the heading on the page)",
  post_content:          "Page content",
  post_excerpt:          "Excerpt",
  post_seo_title:        "Search engine listing title (search results only)",
  post_meta_description: "Search engine listing description",
};

/** Which SEO plugin a site runs, and therefore which meta keys apply. */
export type SeoPlugin = "rankmath" | "yoast" | "none";

const SEO_META_KEYS: Record<Exclude<SeoPlugin, "none">, { title: string; description: string }> = {
  rankmath: { title: "rank_math_title", description: "rank_math_description" },
  yoast:    { title: "_yoast_wpseo_title", description: "_yoast_wpseo_metadesc" },
};

export type WpTarget = {
  /** Site base URL, e.g. https://example.com */
  siteUrl: string;
  /** "posts" | "pages" — the REST collection. */
  postType: "posts" | "pages";
  id: number;
};

export type WpChange = { type: WpChangeType; target: WpTarget; proposed: string };

export type WpStaged = WpChange & {
  current: string;
  targetLabel: string;
  stagedAt: string;
};

export type WpResult = {
  ok: boolean;
  dryRun: boolean;
  before: string;
  after: string;
  revert: { target: WpTarget; type: WpChangeType; value: string };
  detail?: string;
};

function authHeader(username: string, appPassword: string): string {
  // Application passwords arrive with spaces for readability; WP ignores them,
  // but the header must not contain them.
  const clean = appPassword.replace(/\s+/g, "");
  return "Basic " + Buffer.from(`${username}:${clean}`).toString("base64");
}

async function wp<T>(
  target: Pick<WpTarget, "siteUrl">,
  path: string,
  auth: string,
  init?: RequestInit
): Promise<T> {
  const url = `${target.siteUrl.replace(/\/$/, "")}/wp-json${path}`;
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: auth, ...(init?.headers ?? {}) },
  });

  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    // 401/403 on WordPress almost always means the application password is wrong
    // or the site strips the Authorization header (a common Apache default),
    // rather than the user lacking capability. Say so rather than making someone
    // re-check permissions that were never the problem — the GA4 lesson.
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `WordPress refused the credentials (${res.status}). Check the application password, and that ` +
        `the server passes the Authorization header through to PHP. Response: ${body}`
      );
    }
    throw new Error(`WordPress request failed ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Confirm we can reach the site, authenticate, and write.
 *
 * Also reports which SEO plugin is present and whether its fields are actually
 * exposed to REST, because "the plugin is installed" and "we can write its
 * fields" are different claims.
 */
export async function preflight(
  siteUrl: string,
  username: string,
  appPassword: string
): Promise<{ canWrite: boolean; user: string; seoPlugin: SeoPlugin; seoWritable: boolean; capabilities: string[] }> {
  if (mockApis()) {
    return { canWrite: true, user: "mock", seoPlugin: "rankmath", seoWritable: true, capabilities: ["edit_posts"] };
  }

  const auth = authHeader(username, appPassword);

  const me = await wp<{ name: string; capabilities?: Record<string, boolean> }>(
    { siteUrl }, "/wp/v2/users/me?context=edit", auth
  );
  const capabilities = Object.entries(me.capabilities ?? {}).filter(([, v]) => v).map(([k]) => k);
  const canWrite = capabilities.includes("edit_posts") || capabilities.includes("edit_pages");

  // Detect the SEO plugin from the active plugin list where readable, else from
  // the REST schema. Failure to detect is not fatal — it just means SEO change
  // types are unavailable on this site.
  let seoPlugin: SeoPlugin = "none";
  let seoWritable = false;
  try {
    const probe = await wp<{ meta?: Record<string, unknown> }[]>(
      { siteUrl }, "/wp/v2/posts?per_page=1&context=edit", auth
    );
    const meta = probe?.[0]?.meta ?? {};
    if ("rank_math_title" in meta) { seoPlugin = "rankmath"; seoWritable = true; }
    else if ("_yoast_wpseo_title" in meta) { seoPlugin = "yoast"; seoWritable = true; }
  } catch { /* detection is best-effort */ }

  return { canWrite, user: me.name, seoPlugin, seoWritable, capabilities };
}

type WpPost = {
  id: number;
  link: string;
  title?: { raw?: string; rendered?: string };
  content?: { raw?: string };
  excerpt?: { raw?: string };
  meta?: Record<string, unknown>;
};

function readField(post: WpPost, type: WpChangeType, plugin: SeoPlugin): string {
  switch (type) {
    case "post_title":   return post.title?.raw ?? post.title?.rendered ?? "";
    case "post_content": return post.content?.raw ?? "";
    case "post_excerpt": return post.excerpt?.raw ?? "";
    default: {
      if (plugin === "none") return "";
      const keys = SEO_META_KEYS[plugin];
      const key = type === "post_seo_title" ? keys.title : keys.description;
      return String(post.meta?.[key] ?? "");
    }
  }
}

function writeBody(type: WpChangeType, value: string, plugin: SeoPlugin): Record<string, unknown> {
  switch (type) {
    case "post_title":   return { title: value };
    case "post_content": return { content: value };
    case "post_excerpt": return { excerpt: value };
    default: {
      if (plugin === "none") throw new Error("no SEO plugin detected on this site — SEO fields are not writable");
      const keys = SEO_META_KEYS[plugin];
      const key = type === "post_seo_title" ? keys.title : keys.description;
      return { meta: { [key]: value } };
    }
  }
}

/** Read the live value. Writes nothing. */
export async function stage(
  siteUrl: string,
  username: string,
  appPassword: string,
  change: WpChange,
  plugin: SeoPlugin = "none"
): Promise<WpStaged> {
  if (mockApis()) {
    return { ...change, current: `mock current ${change.type}`, targetLabel: "Mock page", stagedAt: new Date().toISOString() };
  }

  const auth = authHeader(username, appPassword);
  // context=edit returns `raw` values — the actual stored content rather than
  // the rendered output. Diffing rendered HTML against a raw proposal would show
  // differences that are not changes.
  const post = await wp<WpPost>(
    { siteUrl }, `/wp/v2/${change.target.postType}/${change.target.id}?context=edit`, auth
  );

  return {
    ...change,
    current: readField(post, change.type, plugin),
    targetLabel: post.title?.rendered ?? post.title?.raw ?? String(change.target.id),
    stagedAt: new Date().toISOString(),
  };
}

/**
 * Apply an approved change. Defaults to dry run — writing to a client's site
 * must be the deliberate choice, never the default a caller forgets to override.
 */
export async function publish(
  siteUrl: string,
  username: string,
  appPassword: string,
  staged: WpStaged,
  opts: { dryRun?: boolean; plugin?: SeoPlugin } = {}
): Promise<WpResult> {
  const dryRun = opts.dryRun ?? true;
  const plugin = opts.plugin ?? "none";
  const revert = { target: staged.target, type: staged.type, value: staged.current };
  const base = { before: staged.current, after: staged.proposed, revert };

  if (dryRun) return { ok: true, dryRun: true, ...base, detail: "dry run — nothing written to the site" };
  // Mock mode must short-circuit the WRITE too, not just the dry run — otherwise
  // a test exercising the real publish path silently hits the network.
  if (mockApis()) return { ok: true, dryRun: false, ...base, detail: "mock — no site contacted" };

  const auth = authHeader(username, appPassword);
  await wp<WpPost>(
    { siteUrl }, `/wp/v2/${staged.target.postType}/${staged.target.id}`, auth,
    { method: "POST", body: JSON.stringify(writeBody(staged.type, staged.proposed, plugin)) }
  );

  return { ok: true, dryRun: false, ...base };
}

/**
 * Reverse a published change.
 *
 * Punch list #1: the caller writes a SECOND ledger entry rather than erasing the
 * first. WordPress additionally keeps its own revision history, so the site's
 * record and ours agree.
 */
export async function revert(
  siteUrl: string,
  username: string,
  appPassword: string,
  r: WpResult["revert"],
  opts: { dryRun?: boolean; plugin?: SeoPlugin } = {}
): Promise<WpResult> {
  const dryRun = opts.dryRun ?? true;
  const plugin = opts.plugin ?? "none";
  const base = { before: "(current)", after: r.value, revert: r };
  if (dryRun) return { ok: true, dryRun: true, ...base, detail: "dry run — nothing reverted" };
  if (mockApis()) return { ok: true, dryRun: false, ...base, detail: "mock — no site contacted" };

  const auth = authHeader(username, appPassword);
  await wp<WpPost>(
    { siteUrl }, `/wp/v2/${r.target.postType}/${r.target.id}`, auth,
    { method: "POST", body: JSON.stringify(writeBody(r.type, r.value, plugin)) }
  );

  return { ok: true, dryRun: false, ...base };
}
