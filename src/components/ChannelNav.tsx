// components/ChannelNav.tsx — per-client workspace tab bar.
//
// WO-003 Stream M. Replaces WO-002's fixed five-tab bar with the design's
// workspace tabs, derived per client from client_type (lib/workspaceTabs.ts).
//
// Two things this fixes:
//   · Revenue is gone as a tab — it folded into Overview (Tom, 2026-07-27),
//     because it duplicated the hero and only ever applied to eCommerce.
//   · GBP and Automation appear only for local-service clients. An eCommerce
//     brand's Business Profile is not what drives its revenue.
//
// Unbuilt tabs stay visible but read as unavailable, so the shape of the product
// is honest about what does and does not exist yet.
import Link from "next/link";
import { workspaceTabs, type ClientType } from "@/lib/workspaceTabs";

export function ChannelNav({
  clientId,
  active,
  clientType,
}: {
  clientId: string;
  active: string;
  clientType: ClientType;
}) {
  const tabs = workspaceTabs(clientType);

  return (
    <nav style={{
      display: "flex", gap: 2, borderBottom: "1px solid var(--border)",
      margin: "0 0 28px", flexWrap: "wrap",
    }}>
      {tabs.map((t) => {
        const on = active === t.key;
        const unbuilt = t.state !== "built";
        return (
          <Link
            key={t.key}
            href={`/dashboard/${clientId}${t.href}`}
            title={t.note}
            style={{
              fontSize: 14, fontWeight: 600, padding: "10px 16px", textDecoration: "none",
              color: on ? "var(--fg1)" : unbuilt ? "var(--fg3)" : "var(--fg2)",
              opacity: unbuilt && !on ? 0.65 : 1,
              borderBottom: on ? "2px solid var(--tm-performance-green)" : "2px solid transparent",
              marginBottom: -1,
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            {t.label}
            {unbuilt && (
              <span style={{
                width: 5, height: 5, borderRadius: "50%",
                background: "var(--border-strong)", flexShrink: 0,
              }} />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
