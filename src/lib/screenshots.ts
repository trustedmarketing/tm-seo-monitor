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
  url: string;          // where the image now lives (our storage, not the vendor's)
  sourceUrl: string;    // the page that was captured
  kind: ShotKind;
  width: number;
  height: number;
  capturedAt: string;
};

const MOCK = () => process.env.MOCK_APIS === "1";

/** Vendor-agnostic capture. Returns a PNG buffer for `pageUrl`. */
async function capture(pageUrl: string, opts: { width: number; fullPage: boolean }): Promise<ArrayBuffer> {
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
  });

  const res = await fetch(`${base}?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`screenshot failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.arrayBuffer();
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

  const { data } = db.storage.from("screenshots").getPublicUrl(path);

  return { url: data.publicUrl, sourceUrl: args.pageUrl, kind: args.kind, width, height: 0, capturedAt };
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
