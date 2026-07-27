// api/ops/screenshot-check — verify the screenshot pipeline end to end, in the
// environment where the credentials actually resolve.
//
// WO-003 Stream B. Sensitive env vars cannot be read back from Vercel by design,
// so the live vendor round-trip cannot be tested from a developer machine. This
// route runs it server-side and reports what happened, without ever returning
// the key or anything derived from it.
//
// Owner-only: it spends vendor credits and reveals whether a third-party
// integration is configured. Visit it signed in as an owner.
//
// Checks, in order, so a failure says WHICH hop broke:
//   1. is the key present at all
//   2. does the vendor accept it and return an image
//   3. does the image upload to our private bucket
//   4. can we mint a signed URL and actually fetch the bytes back
import { getProfile } from "@/lib/supabaseServer";
import { captureFor, signedUrl } from "@/lib/screenshots";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Never echo anything that might carry the credential. */
function safeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const key = process.env.SCREENSHOT_API_KEY;
  const scrubbed = key ? msg.split(key).join("[key]") : msg;
  return scrubbed.slice(0, 300);
}

export async function GET(req: Request) {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }

  const target = new URL(req.url).searchParams.get("url") ?? "https://getsaltydog.com";
  const steps: Record<string, unknown> = {
    target,
    mock_mode: process.env.MOCK_APIS === "1",
    key_present: !!process.env.SCREENSHOT_API_KEY,
    key_length: process.env.SCREENSHOT_API_KEY?.length ?? 0, // length only, never the value
  };

  if (!process.env.SCREENSHOT_API_KEY) {
    return Response.json({ ok: false, failed_at: "key_missing", ...steps }, { status: 200 });
  }

  try {
    const shot = await captureFor({
      targetType: "ops", targetId: "screenshot-check", clientId: "probe",
      pageUrl: target, kind: "before",
    });
    steps.captured_and_uploaded = true;
    steps.storage_path = shot.path;

    // Prove the signed URL genuinely serves the bytes — uploading is not the
    // same as being retrievable from a private bucket.
    const url = await signedUrl(shot.path, 300);
    const res = await fetch(url);
    steps.signed_url_status = res.status;
    steps.bytes = Number(res.headers.get("content-length") ?? 0);
    steps.content_type = res.headers.get("content-type");

    const ok = res.ok && (steps.bytes as number) > 1000;
    return Response.json({ ok, failed_at: ok ? null : "signed_url_fetch", ...steps });
  } catch (e) {
    return Response.json({ ok: false, failed_at: "capture_or_upload", error: safeError(e), ...steps });
  }
}
