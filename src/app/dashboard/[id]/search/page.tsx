// app/dashboard/[id]/search/page.tsx — SEARCH view (WO-002 reorg).
// Organic + paid on the SAME query and landing page — the cannibalization/gap
// catcher (Head of Performance's top pick). Placeholder until the query×paid join
// lands (needs GSC query data + paid search-term data on a shared key).
import Link from "next/link";
import { userClient } from "@/lib/supabaseServer";
import { ClientHeader } from "@/components/ClientHeader";
import "@/styles/tm-tokens.css";

export const dynamic = "force-dynamic";

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sm)" };

export default async function Search({ params }: { params: { id: string } }) {
  const db = userClient();
  const { data: client } = await db.from("clients").select("id, name, domain, tier").eq("id", params.id).single();
  if (!client) return <main style={{ padding: 48 }}>Client not found. <Link href="/dashboard">Back</Link></main>;

  return (
    <main style={{ fontFamily: "var(--font-body)", background: "var(--bg)", minHeight: "100vh", padding: "48px 24px", color: "var(--fg1)" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <ClientHeader id={params.id} name={client.name} domain={client.domain} tier={client.tier} active="search"
          sub="Search — organic and paid on the same query and landing page" />
        <section style={{ ...card, padding: "40px 32px", lineHeight: 1.7 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--tm-green-deep)" }}>Building next</div>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 30, margin: "8px 0 12px", letterSpacing: "-0.01em" }}>
            The one screen where SEO and Paid meet
          </h2>
          <p style={{ fontSize: 15, color: "var(--fg2)", maxWidth: 640, margin: 0 }}>
            This view will put organic position, paid impression share, spend, and revenue on the same
            query and the same landing page — so you can catch <strong>cannibalization</strong> (paying for
            terms you already rank #1 for) and <strong>gaps</strong> (organic on page 2, held up by paid),
            and see revenue at the landing-page level, the currency SEO and Paid share.
          </p>
          <p style={{ fontSize: 13.5, color: "var(--fg3)", marginTop: 14, maxWidth: 640 }}>
            Needs the paid search-term data joined to GSC query data on a shared key — next in the WO-002
            build after the channel shell is confirmed.
          </p>
        </section>
      </div>
    </main>
  );
}
