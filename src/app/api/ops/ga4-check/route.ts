// api/ops/ga4-check — diagnose the GA4 conversions collector.
//
// The collector has failed on every run since 2026-07-22 with "User does not
// have sufficient permissions for this property". A Viewer grant was applied on
// 2026-07-27 and the error did not change, so something is mismatched — and the
// one variable nobody can see is WHICH service account we actually authenticate
// as. Guessing at that cost a day on the screenshot integration; this reports it.
//
// Owner-only. Returns the service account EMAIL (an identifier, not a secret)
// and the property being queried, so the two can be compared against what is
// actually granted in GA4. Never returns the private key.
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return Response.json({ error: "Owner access required" }, { status: 403 });
  }

  const out: Record<string, unknown> = {};

  // 1. Which identity are we presenting?
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    return Response.json({ ok: false, failed_at: "no_credentials", hint: "GOOGLE_SERVICE_ACCOUNT_JSON is not set" });
  }
  let creds: { client_email?: string; project_id?: string; private_key?: string };
  try {
    creds = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, failed_at: "credentials_unparseable" });
  }

  out.service_account_email = creds.client_email;   // grant THIS exact string in GA4
  out.gcp_project = creds.project_id;
  out.private_key_present = !!creds.private_key;

  // 2. Which property are we asking for?
  const url = new URL(req.url);
  const override = url.searchParams.get("property");
  const clientId = url.searchParams.get("client");

  let propertyId = override ?? null;
  if (!propertyId) {
    const q = dbClient().from("clients").select("name, ga4_property_id").not("ga4_property_id", "is", null);
    const { data } = clientId ? await q.eq("id", clientId) : await q.limit(1);
    propertyId = data?.[0]?.ga4_property_id ?? null;
    out.client = data?.[0]?.name;
  }
  out.property_id = propertyId;

  if (!propertyId) {
    return Response.json({ ok: false, failed_at: "no_property_configured", ...out });
  }

  // 3. Does the call actually work? Minimal report — one metric, one day.
  try {
    const { JWT } = await import("google-auth-library");
    const jwt = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    });

    const res = await jwt.request<{ rows?: unknown[] }>({
      url: `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
      method: "POST",
      data: {
        dateRanges: [{ startDate: "yesterday", endDate: "yesterday" }],
        metrics: [{ name: "sessions" }],
      },
    });

    return Response.json({ ok: true, rows_returned: res.data.rows?.length ?? 0, ...out });
  } catch (e) {
    const err = e as { message?: string; response?: { data?: unknown; status?: number } };
    return Response.json({
      ok: false,
      failed_at: "ga4_call",
      status: err.response?.status,
      // The API's own message distinguishes "not granted on this property" from
      // "API not enabled in the project" — two different fixes.
      google_says: JSON.stringify(err.response?.data ?? err.message ?? "").slice(0, 400),
      ...out,
    });
  }
}
