// lib/bloom.ts — brand-aware image generation.
//
// WO-004. Shapes below are from Bloom's published reference, not guessed:
// POST /images/generations {brandSessionId, prompt} returns 202 with
// {data:{id}}, and GET /images/{id}?wait=true returns {id, status, imageUrl}
// with status analyzing | completed | failed.
//
// `wait=true` holds the connection until the image is done, so there is no
// polling loop here. It does mean a generate call can take a minute, which is
// why it never runs inside a page render.
//
// ── The constraint that matters more than the code ───────────────────────────
// Bloom declined a DPA (2026-07-28). We are on a limited pilot, and only assets
// the client has ALREADY PUBLISHED PUBLICLY may go up: logos, storefront
// imagery, live product photography. Nothing unreleased, customer-identifiable
// or confidential. Nothing in this file uploads anything — it sends a text
// prompt and receives a URL — but anyone extending it to upload references needs
// to know that first.
import { mockApis } from "@/lib/apiMock";

const BASE = process.env.BLOOM_API_URL ?? "https://www.trybloom.ai/api/v1";

export type BloomBrand = { id: string; name: string | null; status: string | null };

export class BrandNotReadyError extends Error {
  constructor(brandId: string) {
    super(`Bloom brand ${brandId} is not ready — finish its setup in Bloom before generating.`);
    this.name = "BrandNotReadyError";
  }
}

async function call<T>(path: string, key: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "x-api-key": key,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (res.status === 409) {
    // Bloom's own documented code for this, worth surfacing distinctly because
    // the fix is in Bloom rather than in anything we control.
    throw new BrandNotReadyError("(see brand status)");
  }
  if (!res.ok) {
    throw new Error(`Bloom ${path} failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function listBrands(key: string): Promise<BloomBrand[]> {
  if (mockApis()) return [{ id: "mock-brand", name: "Mock Brand", status: "ready" }];

  const body = await call<unknown>("/brands", key);
  const arr =
    ((body as { data?: unknown })?.data as unknown[]) ??
    ((body as { brands?: unknown })?.brands as unknown[]) ??
    (Array.isArray(body) ? (body as unknown[]) : []);

  return (arr ?? [])
    .filter((b) => b && (b as { id?: unknown }).id != null)
    .map((raw) => {
      const b = raw as { id: string; name?: string | null; status?: string | null };
      return { id: String(b.id), name: b.name ?? null, status: b.status ?? null };
    });
}

/**
 * Generate one image for a brand and return its URL.
 *
 * Synchronous from the caller's point of view thanks to `wait=true`, but it can
 * genuinely take a minute — treat it as a background action, never something a
 * page render waits on.
 */
export async function generateImage(
  key: string,
  brandId: string,
  prompt: string
): Promise<{ id: string; imageUrl: string }> {
  if (mockApis()) {
    return { id: "mock-image", imageUrl: "https://example.test/mock.png" };
  }

  const created = await call<{ data?: { id?: string }; id?: string }>(
    "/images/generations",
    key,
    { method: "POST", body: JSON.stringify({ brandSessionId: brandId, prompt }) }
  );

  const id = created?.data?.id ?? created?.id;
  if (!id) throw new Error(`Bloom accepted the request but returned no image id`);

  const done = await call<{
    data?: { status?: string; imageUrl?: string };
    status?: string; imageUrl?: string;
  }>(`/images/${id}?wait=true`, key);

  const status = done?.data?.status ?? done?.status;
  const imageUrl = done?.data?.imageUrl ?? done?.imageUrl;

  if (status === "failed") {
    throw new Error("Bloom could not generate that image. Try a different prompt.");
  }
  if (status !== "completed" || !imageUrl) {
    // `wait=true` should not return early, but a timeout on their side would
    // look exactly like this and is worth naming rather than treating as a bug.
    throw new Error(`Bloom returned status "${status ?? "unknown"}" with no image URL. Try again.`);
  }

  return { id: String(id), imageUrl };
}

/**
 * Turn a post brief into a visual prompt.
 *
 * Deliberately describes the SUBJECT and leaves styling to Bloom, which already
 * holds the brand's visual identity. Restating brand colours here would fight
 * the thing that makes Bloom worth using.
 *
 * Built mechanically rather than with a model call: it is a description of an
 * already-decided subject, and paying for a second generation to write a prompt
 * for the first would be spending to restate what the brief already says.
 */
export function imagePromptFor(args: {
  brief: string;
  caption?: string | null;
  format?: string | null;
  steer?: string | null;
}): string {
  const { brief, caption, format, steer } = args;

  const subject = brief
    .replace(/\s*(Platform|Format):\s*\w+\.?/gi, "")
    .replace(/^Answer\s+/i, "")
    .replace(/\s+as an? \w+ for \w+\.?/i, "")
    .trim();

  return [
    `Social media image for this post: ${subject}`,
    caption ? `The post says: ${caption.slice(0, 400)}` : "",
    format === "carousel" ? "Design as the first slide of a carousel." : "",
    format === "short" || format === "video" ? "Design as a video thumbnail or opening frame." : "",
    "No text overlay unless it is a single short phrase. Photographic where possible.",
    steer ? `Direction: ${steer}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
