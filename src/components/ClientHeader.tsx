// components/ClientHeader.tsx — shared client page header + channel nav (WO-002).
import Link from "next/link";
import { ChannelNav } from "./ChannelNav";

export function ClientHeader({ id, name, domain, tier, active, sub }: {
  id: string; name: string; domain: string; tier?: string | null; active: string; sub?: React.ReactNode;
}) {
  return (
    <>
      <Link href="/dashboard" style={{ fontSize: 13, fontWeight: 600, color: "var(--fg2)", textDecoration: "none" }}>← Portfolio</Link>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, margin: "14px 0 4px", flexWrap: "wrap" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 48, letterSpacing: "-0.01em", margin: 0 }}>{name}</h1>
        <a href={`https://${domain}`} style={{ fontSize: 14, color: "var(--fg3)", textDecoration: "none" }}>{domain}</a>
        {tier && <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: "var(--radius-pill)", background: "var(--tm-deep-charcoal)", color: "var(--tm-performance-green)" }}>{tier}</span>}
      </div>
      <div style={{ fontSize: 13, color: "var(--fg3)", marginBottom: 24, minHeight: 18 }}>{sub}</div>
      <ChannelNav clientId={id} active={active} />
    </>
  );
}
