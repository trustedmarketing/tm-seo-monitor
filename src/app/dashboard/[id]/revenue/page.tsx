// app/dashboard/[id]/revenue/page.tsx — retired in WO-003 Stream M.
//
// Revenue folded into Overview (Tom, 2026-07-27): it duplicated the Overview
// hero, and it only ever applied to eCommerce clients. For local service the
// same slot is a leads/pipeline variant, which cannot be computed until the
// call-tracking decision (plan §10 decision 0).
//
// Kept as a redirect rather than deleted so existing links and bookmarks land
// somewhere useful instead of a 404.
//
// ⚠️ FOLLOW-UP: this page carried detail the Overview does not yet show — AOV,
// order count, and revenue by source (Shopify actual vs GA4 modeled). That
// belongs in the Overview revenue block. Recorded in WORKLOG rather than
// silently dropped.
import { redirect } from "next/navigation";

export default function Revenue({ params }: { params: { id: string } }) {
  redirect(`/dashboard/${params.id}`);
}
