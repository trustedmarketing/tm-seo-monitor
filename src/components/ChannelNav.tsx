// components/ChannelNav.tsx — per-client channel tab bar (WO-002 reorg).
// Revenue-first Overview + channel views. Server component, no client JS.
import Link from "next/link";

const TABS = [
  { key: "overview", label: "Overview", path: "" },
  { key: "organic", label: "Organic", path: "/organic" },
  { key: "paid", label: "Paid", path: "/paid" },
  { key: "revenue", label: "Revenue", path: "/revenue" },
  { key: "search", label: "Search", path: "/search" },
] as const;

export function ChannelNav({ clientId, active }: { clientId: string; active: string }) {
  return (
    <nav style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--border)", margin: "0 0 28px", flexWrap: "wrap" }}>
      {TABS.map((t) => {
        const on = active === t.key;
        return (
          <Link
            key={t.key}
            href={`/dashboard/${clientId}${t.path}`}
            style={{
              fontSize: 14, fontWeight: 600, padding: "10px 16px", textDecoration: "none",
              color: on ? "var(--fg1)" : "var(--fg3)",
              borderBottom: on ? "2px solid var(--tm-performance-green)" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
