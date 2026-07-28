// lib/workspaceTabs.ts — which tabs a client's workspace has.
//
// WO-003 Stream M. The design export models a single fictional HVAC client and
// so shows one fixed 11-tab set. Reality needs the set derived from what the
// client actually is, and it cuts both ways: Revenue only means something for
// eCommerce, GBP and Automation only for local service.
//
// One decision, one place. If a tab appears somewhere it shouldn't, this file is
// the only thing to change.

export type ClientType = "local_service" | "national_ecom" | "hybrid" | null;

export type TabKey =
  | "overview" | "organic" | "paid" | "search" | "social"
  | "gbp" | "aeo" | "automation" | "playbook" | "qc" | "changes" | "settings";

export type TabState = "built" | "being_built" | "not_connected";

export type Tab = {
  key: TabKey;
  label: string;
  href: string;          // relative to /dashboard/[id]
  state: TabState;
  /** Why it is not usable yet — shown in the tab's empty state, never a bare zero. */
  note?: string;
};

// Tabs every client gets regardless of type.
const UNIVERSAL: TabKey[] = ["overview", "organic", "paid", "search", "social", "aeo", "playbook", "qc", "changes", "settings"];

// Local-service only. An eCommerce brand's Business Profile is not the thing
// driving its revenue, and the automation menu is largely a local-service play.
const LOCAL_ONLY: TabKey[] = ["gbp", "automation"];

const LABELS: Record<TabKey, string> = {
  overview: "Overview", organic: "Organic", paid: "Paid", search: "Search",
  social: "Social", gbp: "GBP", aeo: "AEO", automation: "Automation",
  playbook: "Playbook", qc: "QC", changes: "Changes", settings: "Settings",
};

// What is actually built today. Everything else renders an honest holding state
// rather than an empty zero — the discipline the feasibility review demanded for
// GBP, LinkedIn and Google, applied to our own unfinished tabs.
const BUILT: TabKey[] = ["overview", "organic", "paid", "search", "changes", "aeo", "qc"];

const BLOCKED: Partial<Record<TabKey, string>> = {
  gbp: "Waiting on Google Business Profile API access, submitted 27 Jul.",
  social: "Waiting on the organic-social collector.",
  automation: "Being built.",
  playbook: "Being built.",
  settings: "Being built.",
};

export function isLocal(type: ClientType): boolean {
  return type === "local_service" || type === "hybrid";
}

/**
 * The workspace tab set for a client.
 *
 * An unclassified client (client_type null) gets the universal set only. That is
 * deliberate: showing GBP to a client we have not classified would be a guess,
 * and a missing tab is easier to notice than a wrong one.
 */
export function workspaceTabs(type: ClientType): Tab[] {
  const keys = [...UNIVERSAL];
  if (isLocal(type)) keys.push(...LOCAL_ONLY);

  // Keep the design's reading order rather than insertion order.
  const ORDER: TabKey[] = [
    "overview", "organic", "paid", "search", "social", "gbp",
    "aeo", "automation", "playbook", "qc", "changes", "settings",
  ];

  return ORDER.filter((k) => keys.includes(k)).map((key) => ({
    key,
    label: LABELS[key],
    href: key === "overview" ? "" : `/${key}`,
    state: BUILT.includes(key) ? "built" : (key === "gbp" ? "not_connected" : "being_built"),
    note: BUILT.includes(key) ? undefined : BLOCKED[key],
  }));
}

/**
 * Whether the Overview's revenue block has ground truth to show.
 *
 * Revenue was folded into Overview (Tom, 2026-07-27) because it duplicated the
 * hero and only ever applied to eCommerce. For local service the same slot is a
 * leads/pipeline variant, which stays empty until the call-tracking decision
 * (plan §10 decision 0) — we cannot compute jobs booked or cost per job today,
 * and inventing them would be worse than an honest blank.
 */
export function revenueMode(type: ClientType): "shopify" | "leads_pending" | "unknown" {
  if (type === "national_ecom") return "shopify";
  if (isLocal(type)) return "leads_pending";
  return "unknown";
}
