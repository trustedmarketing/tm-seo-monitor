// api/ops/stage-change — turn a proposed change into an approval card.
//
// WO-003 Stream D/E-S. This is the seam the recommendations engine will use:
// something decides a change is worth making, the adapter reads the live value,
// and a card appears in the queue with the work already done.
//
// Owner-only and manual for now. It writes NOTHING to the client's store — it
// reads the current value and stages the proposal in our database. The store is
// only touched when a human approves the resulting card.
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { readSecret } from "@/lib/vault";
import { writeAudit } from "@/lib/audit";
import { connect, stage, type ShopifyChangeType } from "@/lib/shopifyAdapter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SERP_KIND: Partial<Record<ShopifyChangeType, "title" | "description">> = {
  page_seo_title: "title",
  article_seo_title: "title",
  page_meta_description: "description",
  article_meta_description: "description",
};

export async function GET(req: Request) {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  const p = new URL(req.url).searchParams;
  const gid = p.get("page");
  const proposed = p.get("to");
  const changeType = (p.get("type") ?? "page_seo_title") as ShopifyChangeType;
  const why = p.get("why") ?? undefined;

  if (!gid || !proposed) {
    return NextResponse.json({
      error: "need ?page=<gid>&to=<new value>",
      optional: "&type=page_seo_title|page_meta_description&why=<reason>",
    }, { status: 400 });
  }

  const db = dbClient();
  const { data: store } = await db
    .from("client_stores")
    .select("client_id, domain, api_client_id, auth_ref")
    .eq("platform", "shopify").limit(1).maybeSingle();

  if (!store?.api_client_id || !store.auth_ref) {
    return NextResponse.json({ error: "no configured shopify store" }, { status: 400 });
  }

  const secret = await readSecret(db, store.auth_ref);
  if (!secret) return NextResponse.json({ error: "vault secret missing" }, { status: 400 });

  try {
    const token = await connect(store.domain, store.api_client_id, secret);

    // Reads the live value. Writes nothing.
    const staged = await stage(store.domain, token, { type: changeType, targetGid: gid, proposed });

    if (staged.current === proposed) {
      return NextResponse.json({
        ok: false,
        reason: "no_change",
        detail: "The live value already equals the proposal — nothing to approve.",
        current: staged.current,
      });
    }

    // SLA clock starts now. Punch list #9 gives it a consequence later.
    const sla = new Date();
    sla.setHours(sla.getHours() + 24);

    const { data: row, error } = await db.from("approvals").insert({
      client_id: store.client_id,
      variant: "site",
      status: "staged",
      severity: "Medium",
      title: `Update ${changeType.replace(/_/g, " ")} on ${staged.targetLabel}`,
      why: why ?? null,
      staged_by: `Manual · ${profile.email}`,
      qc_passed: 1, qc_total: 1,
      requires_role: "specialist",
      sla_due_at: sla.toISOString(),
      // Deterministic: staging the same change twice reuses the same key and
      // the unique constraint refuses a duplicate card.
      idempotency_key: `stage:${gid}:${changeType}:${proposed}`.slice(0, 200),
      payload: {
        adapter: "shopify",
        changeType,
        targetGid: gid,
        targetLabel: staged.targetLabel,
        before: staged.current,
        after: proposed,
        serpKind: SERP_KIND[changeType] ?? null,
      },
    }).select("id").maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message, hint: "a card for this exact change may already exist" }, { status: 409 });
    }

    await writeAudit(
      { action: "approve", targetType: "approval", targetId: row?.id ?? null, clientId: store.client_id,
        before: { value: staged.current }, after: { value: proposed },
        detail: `staged ${changeType} on ${staged.targetLabel}` },
      profile
    );

    return NextResponse.json({
      ok: true,
      approval_id: row?.id,
      target: staged.targetLabel,
      before: staged.current,
      after: proposed,
      next: "/dashboard/approvals",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message.slice(0, 300) }, { status: 500 });
  }
}
