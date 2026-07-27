// lib/screenshots.ts — before/after screenshot capture.
//
// WO-003 Stream B. The Approval Card's central claim is visual: "the work is
// already done before you see it". Without a real before and after image that
// claim is just text, and the reviewer is being asked to trust a description.
//
// Vendor decided over self-hosted Playwright (CTO call, 2026-07-27): owning
// browser infrastructure to save a few dollars a month is a poor trade. The
// adapter is written against a generic REST shape so ScreenshotOne, Browserless
// or a self-hosted runner are swappable — same reasoning as keeping the creative
// generator behind our own interface so the vendor stays replaceable.
//
// MOCK_APIS=1 returns fixtures, matching every other collector in this repo, so
// the pipeline is testable before the vendor account exists.
import { dbClient } from "@/lib/db";

export type ShotKind = "before" | "after";

export type Shot = {
  /**
   * Storage path. THIS is what gets persisted against the approval, never a URL.
   *
   * The bucket is private, so a link is a temporary grant rather than an address.
   * Storing a signed URL would bake in an expiry and, worse, leave a working
   * link to a client's staged page sitting in the database.
   */
  path: string;
  /** Short-lived signed URL for rendering now. Regenerate at render time. */
  url: string;
  sourceUrl: string;    // the page that was captured
  kind: ShotKind;
  width: number;
  height: number;
  capturedAt: string;
};

/** How long a rendered screenshot link stays valid. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

const MOCK = () => process.env.MOCK_APIS === "1";

/**
 * A realistic browser UA.
 *
 * Shopify (and Cloudflare-fronted sites generally) rate-limit or challenge
 * unfamiliar datacenter traffic. Verified 2026-07-27: getsaltydog.com returned
 * 429 to three consecutive capture attempts while stripe.com captured fine from
 * the same account — so it is the target host refusing, not the vendor failing.
 */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Thrown when the TARGET site refused, as opposed to the vendor failing. */
export class HostRefusedError extends Error {
  constructor(readonly status: number, readonly pageUrl: string) {
    super(
      `${pageUrl} returned ${status} to the capture service` +
        (status === 429 ? " (rate limited — the site is blocking automated traffic)" : "")
    );
    this.name = "HostRefusedError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Vendor-agnostic capture. Returns a PNG buffer for `pageUrl`. */
async function capture(
  pageUrl: string,
  opts: { width: number; fullPage: boolean; attempts?: number }
): Promise<ArrayBuffer> {
  const key = process.env.SCREENSHOT_API_KEY;
  const base = process.env.SCREENSHOT_API_URL ?? "https://api.screenshotone.com/take";
  if (!key) throw new Error("SCREENSHOT_API_KEY missing");

  const params = new URLSearchParams({
    access_key: key,
    url: pageUrl,
    viewport_width: String(opts.width),
    full_page: String(opts.fullPage),
    format: "png",
    // Cache off: a "before" shot must be the page as it is right now, not a
    // vendor-cached copy from an earlier capture. A stale before/after pair is
    // worse than none, because it looks like evidence.
    cache: "false",
    block_cookie_banners: "true",
    block_ads: "true",
    user_agent: UA,
    // Do NOT set ignore_host_errors. The vendor offers it, and it would make
    // this "succeed" by screenshotting the 429 page — an approval card showing a
    // rate-limit page as the client's homepage is worse than an honest failure.
  });

  const attempts = opts.attempts ?? 3;
  let lastStatus = 0;

  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${base}?${params}`, { cache: "no-store" });
    if (res.ok) return res.arrayBuffer();

    const body = await res.text();
    // Distinguish "the site refused us" from "the vendor broke". Only the first
    // is worth retrying, and only the first is the client's site talking.
    let hostStatus = 0;
    try {
      const j = JSON.parse(body);
      if (j?.error_code === "host_returned_error") hostStatus = Number(j.returned_status_code) || 0;
    } catch { /* not JSON */ }

    if (!hostStatus) {
      throw new Error(`screenshot failed ${res.status}: ${body.slice(0, 200)}`);
    }
    lastStatus = hostStatus;

    // Retry only transient refusals. A 403/404 will not improve by waiting.
    const transient = hostStatus === 429 || hostStatus >= 500;
    if (!transient || i === attempts - 1) break;

    await sleep(2000 * 2 ** i); // 2s, 4s
  }

  throw new HostRefusedError(lastStatus, pageUrl);
}

/**
 * Capture a page and store it against a target (an approval, a change).
 *
 * Images are re-hosted into our own Supabase Storage rather than linked from the
 * vendor. Losing the vendor should cost us the generator, not the evidence — the
 * same zero-lock-in rule the plan applies to Bloom.
 */
export async function captureFor(args: {
  targetType: string;
  targetId: string;
  clientId: string;
  pageUrl: string;
  kind: ShotKind;
  width?: number;
  fullPage?: boolean;
}): Promise<Shot> {
  const width = args.width ?? 1440;
  const capturedAt = new Date().toISOString();
  const path = `${args.clientId}/${args.targetType}/${args.targetId}/${args.kind}.png`;

  if (MOCK()) {
    return {
      path,
      url: `mock://screenshots/${path}`,
      sourceUrl: args.pageUrl,
      kind: args.kind,
      width,
      height: 900,
      capturedAt,
    };
  }

  const png = await capture(args.pageUrl, { width, fullPage: args.fullPage ?? false });

  const db = dbClient();
  const { error } = await db.storage.from("screenshots").upload(path, png, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw new Error(`screenshot upload failed: ${error.message}`);

  return { path, url: await signedUrl(path), sourceUrl: args.pageUrl, kind: args.kind, width, height: 0, capturedAt };
}

/**
 * A time-limited link to a stored screenshot.
 *
 * The bucket is private on purpose: these images show a client's site, sometimes
 * a staged page that is not public yet. A public bucket would make every
 * screenshot guessable by URL forever.
 */
export async function signedUrl(path: string, ttl = SIGNED_URL_TTL_SECONDS): Promise<string> {
  if (MOCK()) return `mock://screenshots/${path}`;
  const { data, error } = await dbClient().storage
    .from("screenshots").createSignedUrl(path, ttl);
  if (error) throw new Error(`signing failed: ${error.message}`);
  return data.signedUrl;
}

/**
 * Capture both sides of a staged change in one call.
 *
 * Both are taken at the same moment on purpose: capturing "before" hours earlier
 * lets unrelated drift creep into the comparison, and a before/after pair that
 * silently includes someone else's change is a misleading artefact rather than
 * evidence.
 */
export async function captureBeforeAfter(args: {
  targetType: string;
  targetId: string;
  clientId: string;
  liveUrl: string;
  stagedUrl: string;
  width?: number;
}): Promise<{ before: Shot; after: Shot }> {
  const [before, after] = await Promise.all([
    captureFor({ ...args, pageUrl: args.liveUrl, kind: "before" }),
    captureFor({ ...args, pageUrl: args.stagedUrl, kind: "after" }),
  ]);
  return { before, after };
}
