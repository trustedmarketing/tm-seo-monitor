// components/ClientHeader.tsx — shared client workspace header + tab bar.
//
// WO-003 Stream M: takes clientType so the tab set is derived per client rather
// than fixed. See lib/workspaceTabs.ts for why that matters in both directions.
//
// An unclassified client gets a visible badge rather than a silent fallback. A
// client we have not typed is a gap in onboarding, and gaps should be seen.
import Link from "next/link";
import { ChannelNav } from "./ChannelNav";
import type { ClientType } from "@/lib/workspaceTabs";

export function ClientHeader({ id, name, domain, tier, active, sub, clientType, pending }: {
  id: string; name: string; domain: string; tier?: string | null;
  active: string; sub?: React.ReactNode; clientType?: ClientType;
  /**
   * Cards waiting on a decision for this client.
   *
   * The queue stays one work surface — this does not split it. It just makes
   * pending work discoverable from where someone already is, rather than relying
   * on them remembering to check a separate page.
   */
  pending?: number;
}) {
  return (
    <>
      <Link href="/dashboard" style={{ fontSize: 13, fontWeight: 600, color: "var(--fg2)", textDecoration: "none" }}>← Portfolio</Link>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, margin: "14px 0 4px", flexWrap: "wrap" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 48, letterSpacing: "-0.01em", margin: 0 }}>{name}</h1>
        <a href={`https://${domain}`} style={{ fontSize: 14, color: "var(--fg3)", textDecoration: "none" }}>{domain}</a>
        {tier && <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: "var(--radius-pill)", background: "var(--tm-deep-charcoal)", color: "var(--tm-performance-green)" }}>{tier}</span>}
        {!!pending && (
          <Link href={`/dashboard/approvals?client=${id}`} style={{
            fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: "var(--radius-pill)",
            background: "var(--tm-performance-green)", color: "#080808", textDecoration: "none",
          }}>
            {pending} waiting on a decision →
          </Link>
        )}
        {!clientType && (
          <span title="Set the client type so this workspace shows the right tabs"
                style={{ fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: "var(--radius-pill)", background: "#FFF9EC", color: "#8A6D1F", border: "1px solid #EAD9A6" }}>
            Unclassified
          </span>
        )}
      </div>
      <div style={{ fontSize: 13, color: "var(--fg3)", marginBottom: 24, minHeight: 18 }}>{sub}</div>
      <ChannelNav clientId={id} active={active} clientType={clientType ?? null} />
    </>
  );
}
