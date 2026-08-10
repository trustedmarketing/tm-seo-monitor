// api/clients/spend-guards — set per-client/platform ad spend ceilings.
//
// WO-006 stream J. The ceilings themselves have been enforced since stream D
// (lib/adSpendGuard.ts, called from approvals/route.ts before any adapter
// dispatch); until now they could only be set by running SQL by hand, which
// meant the guardrail existed but nobody could operate it.
//
// OWNER-only, unlike personas/settings which are agency-wide. Raising a spend
// ceiling is how you make a blocked budget change approvable — if the same
// person who wants a big budget through can also lift the limit that stops it,
// the limit is decoration. Same reasoning as /admin being owner-only while
// research is any agency role.
//
// Form-POST-with-redirect convention (api/clients/personas), writes via the
// service-role client because ad_spend_guards' RLS grants select only.
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { parseCeiling } from "@/lib/adSpendGuard";

export const dynamic = "force-dynamic";

const PLATFORMS = ["meta", "google_ads", "microsoft"];

function back(req: Request, clientId: string, msg: string) {
  const url = new URL(`/dashboard/${clientId}/paid/guardrails`, req.url);
  url.searchParams.set("msg", msg);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(req: Request) {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  const form = await req.formData();
  const clientId = String(form.get("client_id") ?? "");
  const platform = String(form.get("platform") ?? "");
  if (!clientId) return NextResponse.json({ error: "client_id required" }, { status: 400 });
  if (!PLATFORMS.includes(platform)) return back(req, clientId, "guard-bad-platform");

  const daily = parseCeiling(form.get("daily_ceiling") as string | null);
  const monthly = parseCeiling(form.get("monthly_ceiling") as string | null);
  if (!daily.ok) return back(req, clientId, "guard-bad-daily");
  if (!monthly.ok) return back(req, clientId, "guard-bad-monthly");

  // Both blank removes the row entirely rather than storing a pair of nulls.
  // checkSpendGuard() treats a missing row and an all-null row identically, so
  // keeping the empty row would just be a record that says nothing.
  const db = dbClient();
  if (daily.value == null && monthly.value == null) {
    await db.from("ad_spend_guards").delete().eq("client_id", clientId).eq("platform", platform);
    await writeAudit(
      { action: "budget_change", targetType: "client", targetId: clientId, clientId, detail: `spend guard removed for ${platform} — no ceiling now enforced` },
      profile
    );
    return back(req, clientId, "guard-removed");
  }

  const payload = {
    client_id: clientId,
    platform,
    daily_ceiling: daily.value,
    monthly_ceiling: monthly.value,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await db
    .from("ad_spend_guards")
    .select("id")
    .eq("client_id", clientId)
    .eq("platform", platform)
    .maybeSingle();

  if (existing) {
    await db.from("ad_spend_guards").update(payload).eq("id", (existing as { id: string }).id);
  } else {
    await db.from("ad_spend_guards").insert(payload);
  }

  // Audited because this changes what the platform is allowed to spend. A
  // ceiling that moved with no record of who moved it is exactly the gap the
  // guardrail is supposed to close.
  await writeAudit(
    {
      action: "budget_change",
      targetType: "client",
      targetId: clientId,
      clientId,
      detail:
        `spend guard set for ${platform}: ` +
        `daily=${daily.value == null ? "none" : "$" + daily.value} ` +
        `monthly=${monthly.value == null ? "none" : "$" + monthly.value}`,
    },
    profile
  );

  return back(req, clientId, "guard-saved");
}
