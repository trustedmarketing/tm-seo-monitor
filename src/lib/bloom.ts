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
export async function startImage(
  key: string,
  brandId: string,
  prompt: string,
  /** e.g. "9:16". Sent as a field AND stated in the prompt — see below. */
  aspectRatio?: string | null
): Promise<string | null> {
  if (mockApis()) return "mock-image";

  // Bloom documents only brandSessionId and prompt. Their image objects carry an
  // `aspect_ratio`, so the field probably exists on generation too — but "probably"
  // has been wrong four times on this integration today, so the ratio is ALSO
  // stated in the prompt. An ignored field costs nothing; a silently square image
  // in a 9:16 slot costs a repost.
  // /images/generations, because it is the endpoint that DEMONSTRABLY works —
  // every image in Tom's library came from it. The docs index also lists
  // POST /images; switching to it on that basis broke generation entirely, which
  // is a good argument for preferring observed behaviour over documentation when
  // the two disagree.
  const created = await call<unknown>("/images/generations", key, {
    method: "POST",
    body: JSON.stringify({
      brandSessionId: brandId,
      prompt,
      ...(aspectRatio ? { aspectRatio, aspect_ratio: aspectRatio } : {}),
    }),
  });

  // An id if we can find one — but its absence is NOT a failure. The generation
  // has started either way, and the first version threw here, which meant Bloom
  // produced a perfectly good image while the slot recorded nothing at all.
  return findImageId(created);
}

/**
 * Find a generation we started but have no id for.
 *
 * Matches on brand, on being created after we asked, and on the prompt, so two
 * slots generating at once cannot collect each other's artwork.
 */
export async function findStartedImage(
  key: string,
  brandId: string,
  since: Date,
  prompt: string
): Promise<BloomImage | null> {
  const recent = await listImages(key, brandId, 10);
  // A minute of slack: their created_at and our clock will not agree exactly.
  const cutoff = since.getTime() - 60_000;
  const head = prompt.slice(0, 80);

  return (
    recent.find((i) => {
      const t = i.createdAt ? new Date(i.createdAt).getTime() : 0;
      if (t < cutoff) return false;
      return !i.prompt || i.prompt.slice(0, 80) === head;
    }) ?? null
  );
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
  prompt: string | null; createdAt: string | null; brandId: string | null;
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
              prompt: null, createdAt: new Date().toISOString(), brandId: "mock-brand" }];
  }

  // No query parameters. Their docs list cursor / status / action_type / ids /
  // wait — and notably NOT limit, which is what the previous version sent. That
  // call errored, the caller swallowed it, and a finished image sat uncollected
  // with nothing anywhere saying why.
  //
  // Each image carries brand_session_id, so the brand filter happens here on a
  // field observed in a live response rather than a parameter name invented.
  const body = await call<unknown>(`/images`, key);
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
        brandId: ((i.brand_session_id ?? i.brandSessionId) as string) ?? null,
      };
    })
    .filter((i) => !i.brandId || i.brandId === brandId)
    .slice(0, limit);
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
 * Normalise a Bloom URL to something an <img> can actually load.
 *
 * Bloom's UI hands you a SHARE link — /i/{id} — which is a viewer page, not an
 * image. Pasted into an image field it renders as nothing at all: the tag is
 * there, the src is HTML, and the slot looks broken for no visible reason.
 *
 * The direct asset is /img/{id}. Anyone copying from Bloom will paste the share
 * link, so converting it is the fix rather than telling people to hand-edit a URL.
 */
export function normaliseImageUrl(url: string): string {
  const trimmed = url.trim();
  const share = trimmed.match(/^https?:\/\/(?:www\.)?trybloom\.ai\/i\/([\w-]+)/i);
  if (share) return `https://www.trybloom.ai/img/${share[1]}`;
  return trimmed;
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
  /** Two to four words, written alongside the caption. */
  headline?: string | null;
  /** The ratio the slot needs, e.g. "9:16". */
  aspectRatio?: string | null;
  /** What THIS slide's photograph shows. Replaces the hero framing. */
  shot?: string | null;
  /** The cover keeps the hero framing; later slides do not. */
  isCover?: boolean;
}): string {
  const { brief, caption, format, steer, headline, aspectRatio, shot, isCover } = args;

  const subject = brief
    .replace(/\s*(Platform|Format):\s*\w+\.?/gi, "")
    .replace(/^Answer\s+/i, "")
    .replace(/\s+as an? \w+ for \w+\.?/i, "")
    .trim();

  // First sentence only. An earlier version passed 400 characters of caption,
  // which put four paragraphs of advice into an image prompt and pushed the
  // model toward setting the post's question as the overlay — small, thin, and
  // asking rather than claiming.
  const gist = caption ? caption.split(/(?<=[.!?])\s/)[0].slice(0, 160) : "";

  return [
    `Social media image. Subject: ${subject}`,
    gist ? `Context: ${gist}` : "",

    "Style: photographic and real, not illustrated or rendered. Natural light.",

    // The hero framing is what made six carousel slides identical: the same
    // "product hero, packaging visible" instruction produced the same photograph
    // every time, with only the words changing. It belongs on the COVER and on
    // single-image posts, not on a detail slide.
    shot && !isCover
      ? [
          `Show this specifically: ${shot}`,
          "This is one slide within a carousel. Do NOT repeat the cover's composition.",
          "If the shot describes a diagram, comparison or labelled detail, make it clean and",
          "graphic rather than a product photograph — an explanatory slide is not a product",
          "shot with words on it. If it describes a real scene or object, photograph that.",
          "The product need not be shown whole, and the packaging need not appear.",
        ].join(" ")
      : [
          "Shoot it as a product hero in the setting the product is actually used in.",
          "The product packaging should be clearly visible and legible.",
        ].join(" "),

    headline
      ? [
          `Set this headline across the image: "${headline.toUpperCase()}".`,
          // The specific failure being corrected: type came back small and thin,
          // so the size instruction is stated as a proportion rather than an
          // adjective, which a model can act on.
          "Set it in a heavy condensed sans-serif, uppercase, occupying roughly a third of the",
          "image width, high contrast against what sits behind it. Large and confident.",
          "No other text anywhere in the image. No paragraphs, no bullet points, no small print.",
        ].join(" ")
      : "No text overlay of any kind.",

    // Stated in words as well as sent as a field. The card promises a ratio to
    // whoever is reviewing, and an image that does not match it gets cropped by
    // the platform — usually through the headline.
    aspectRatio ? `Compose for a ${aspectRatio} frame, and fill it.` : "",
    format === "carousel" ? "Compose as the first slide of a carousel." : "",
    format === "short" || format === "video" ? "Compose as a video thumbnail or opening frame." : "",
    steer ? `Direction: ${steer}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
