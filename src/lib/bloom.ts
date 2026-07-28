// lib/bloom.ts — brand-aware image generation.
//
// WO-004. Shapes below are from Bloom's published reference, not guessed:
// POST /images/generations {brandSessionId, prompt} returns 202 with
// {data:{id}}, and GET /images/{id}?wait=true returns {id, status, imageUrl}
// with status analyzing | completed | failed.
//
// Generation is ASYNCHRONOUS here by design. Bloom offers `wait=true`, which
// holds the connection until the image is done, and the first version used it —
// that blocked the browser for a minute with no feedback and would have been
// killed by the platform's function timeout. startImage() records the job and
// checkImage() collects it.
//
// ── The constraint that matters more than the code ───────────────────────────
// Bloom declined a DPA (2026-07-28). We are on a limited pilot, and only assets
// the client has ALREADY PUBLISHED PUBLICLY may go up: logos, storefront
// imagery, live product photography. Nothing unreleased, customer-identifiable
// or confidential. Nothing in this file uploads anything — it sends a text
// prompt and receives a URL — but anyone extending it to upload references needs
// to know that first.
import { mockApis } from "@/lib/apiMock";
import { findArray, describeShape } from "@/lib/apiShape";

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
  const arr = findArray(body);

  if (!arr) {
    throw new Error(`Bloom returned brands in an unrecognised shape: ${describeShape(body)}`);
  }

  return arr
    .filter((b) => b && (b as { id?: unknown }).id != null)
    .map((raw) => {
      const b = raw as { id: string; name?: string | null; status?: string | null };
      return { id: String(b.id), name: b.name ?? null, status: b.status ?? null };
    });
}

/**
 * Ask Bloom to start generating. Returns as soon as it has an id.
 *
 * The first version used `wait=true` and held the request open for the whole
 * generation. That blocked the browser for a minute with no feedback and would
 * have been killed by the platform's function timeout anyway. Bloom hands back
 * an id immediately; the right shape is to store it and check later.
 */
export async function startImage(key: string, brandId: string, prompt: string): Promise<string> {
  if (mockApis()) return "mock-image";

  const created = await call<unknown>("/images/generations", key, {
    method: "POST",
    body: JSON.stringify({ brandSessionId: brandId, prompt }),
  });

  const id = findImageId(created);
  if (id) return id;

  // The POST response does not carry an id in any shape we recognise, but the
  // generation itself has started — Tom watched one complete in Bloom while this
  // was erroring. So ask the brand for its newest image instead. Bounded to
  // images created within the last two minutes so a much older one can never be
  // mistaken for the one we just requested.
  const cutoff = Date.now() - 2 * 60_000;
  const recent = await listImages(key, brandId, 5);
  const mine = recent.find((i) => {
    const t = i.createdAt ? new Date(i.createdAt).getTime() : 0;
    return t >= cutoff;
  });

  if (!mine) {
    throw new Error(
      `Bloom started a generation but returned no id, and no new image appeared for this brand. ` +
      `Response was: ${describeShape(created, 300)}`
    );
  }
  return mine.id;
}

/**
 * Pull a generation id out of whatever Bloom returned.
 *
 * The docs describe {data:{id}}. That is not what came back, and rather than
 * guess a second shape this looks in every plausible place and hands the raw
 * payload to the caller when it finds nothing. A generation can also return
 * several images, in which case the first is the one we asked about.
 */
function findImageId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const direct = [
    b.id, b.imageId, b.image_id, b.generationId, b.generation_id,
    (b.data as Record<string, unknown>)?.id,
    (b.data as Record<string, unknown>)?.imageId,
    (b.data as Record<string, unknown>)?.image_id,
    (b.image as Record<string, unknown>)?.id,
  ].find((v) => typeof v === "string" || typeof v === "number");

  if (direct != null) return String(direct);

  // A list of created images: take the first.
  const arr = findArray(body);
  const first = arr?.[0] as Record<string, unknown> | undefined;
  const fromList = first?.id ?? first?.imageId ?? first?.image_id;
  return fromList != null ? String(fromList) : null;
}

export type BloomImage = {
  id: string; status: string | null; imageUrl: string | null;
  prompt: string | null; createdAt: string | null;
};

/**
 * Recent images for a brand, newest first.
 *
 * Exists because the POST response shape is not what the docs describe and we
 * could not find an id in it. Rather than keep guessing that shape, generation
 * can fall back to "find the newest image for this brand created after I asked",
 * which depends only on the LIST response — a shape we have actually seen.
 */
export async function listImages(key: string, brandId: string, limit = 5): Promise<BloomImage[]> {
  if (mockApis()) {
    return [{ id: "mock-image", status: "completed", imageUrl: "https://example.test/mock.png",
              prompt: null, createdAt: new Date().toISOString() }];
  }

  const body = await call<unknown>(
    `/images?brandSessionId=${encodeURIComponent(brandId)}&limit=${limit}`,
    key
  );
  const arr = findArray(body);
  if (!arr) throw new Error(`Bloom returned images in an unrecognised shape: ${describeShape(body)}`);

  return arr
    .filter((i) => i && (i as { id?: unknown }).id != null)
    .map((raw) => {
      const i = raw as Record<string, unknown>;
      return {
        id: String(i.id),
        status: (i.status as string) ?? null,
        // Their own field is snake_case; camelCase accepted in case it varies.
        imageUrl: ((i.image_url ?? i.imageUrl ?? i.url) as string) ?? null,
        prompt: (i.prompt as string) ?? null,
        createdAt: (i.created_at as string) ?? (i.createdAt as string) ?? null,
      };
    });
}

export type ImageState =
  | { status: "generating" }
  | { status: "completed"; imageUrl: string }
  | { status: "failed"; reason: string };

/** Check a generation without waiting on it. */
export async function checkImage(key: string, imageId: string): Promise<ImageState> {
  if (mockApis()) return { status: "completed", imageUrl: "https://example.test/mock.png" };

  const body = await call<unknown>(`/images/${imageId}`, key);
  const b = (body ?? {}) as Record<string, unknown>;
  const d = (b.data ?? {}) as Record<string, unknown>;

  const status = (d.status ?? b.status) as string | undefined;
  // Same tolerance on the way out: the URL field has several plausible names.
  const imageUrl = (d.imageUrl ?? b.imageUrl ?? d.image_url ?? b.image_url ?? d.url ?? b.url) as
    | string
    | undefined;

  if (status === "completed" && imageUrl) return { status: "completed", imageUrl };
  if (status === "failed") {
    return { status: "failed", reason: "Bloom could not generate that image. Try a different direction." };
  }
  // analyzing, or anything unrecognised. Treating an unknown status as still
  // working is safer than declaring failure on a value we have not seen before.
  return { status: "generating" };
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

  // First sentence only. The earlier version passed 400 characters of caption,
  // which put four paragraphs of advice into an image prompt and pushed the
  // model toward rendering the question as a text overlay. An image prompt wants
  // a subject, not the post.
  const gist = caption
    ? caption.split(/(?<=[.!?])\s/)[0].slice(0, 160)
    : "";

  return [
    `Social media image for this post: ${subject}`,
    gist ? `Context: ${gist}` : "",
    format === "carousel" ? "Design as the first slide of a carousel." : "",
    format === "short" || format === "video" ? "Design as a video thumbnail or opening frame." : "",
    "No text overlay unless it is a single short phrase. Photographic where possible.",
    steer ? `Direction: ${steer}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
