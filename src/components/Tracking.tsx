"use client";
// components/Tracking.tsx — interactive pieces for the client detail page:
// recommendation action buttons and the manual change logger. Admin-only
// (the API enforces; the page only renders these for admins).
import { useState } from "react";

const btn: React.CSSProperties = {
  fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 12,
  padding: "6px 12px", borderRadius: 999, cursor: "pointer",
  background: "transparent", color: "var(--fg1)", border: "1px solid var(--border-strong)",
};
const btnSolid: React.CSSProperties = {
  ...btn, background: "var(--tm-performance-green)", color: "#080808", border: "1px solid transparent",
};
const input: React.CSSProperties = {
  fontFamily: "var(--font-body)", fontSize: 13, padding: "8px 10px",
  border: "1px solid var(--border-strong)", borderRadius: 8, background: "#fff",
};

async function track(body: Record<string, unknown>) {
  const res = await fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

// ── Per-recommendation actions ───────────────────────────────────
export function RecActions({ recId, clientId, status, keywords }: {
  recId: string; clientId: string; status: string; keywords: string[];
}) {
  const [shipOpen, setShipOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState("");

  async function setStatus(s: string) {
    try { await track({ action: "rec_status", id: recId, status: s }); location.reload(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function ship() {
    try {
      await track({
        action: "log_change", client_id: clientId, recommendation_id: recId,
        title: title || "Implemented recommendation", changed_at: date,
        affected_keywords: keywords,
      });
      location.reload();
    } catch (e) { setErr((e as Error).message); }
  }

  if (["validated", "no_effect", "measuring", "dismissed", "resolved"].includes(status)) return null;

  return (
    <div style={{ marginTop: 8 }}>
      {!shipOpen ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {status === "open" && <button style={btn} onClick={() => setStatus("approved")}>Approve</button>}
          <button style={btnSolid} onClick={() => setShipOpen(true)}>Mark shipped</button>
          <button style={btn} onClick={() => setStatus("dismissed")}>Dismiss</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ ...input, minWidth: 220 }} placeholder="What was done (short)"
            value={title} onChange={(e) => setTitle(e.target.value)} />
          <input type="date" style={input} value={date} onChange={(e) => setDate(e.target.value)} />
          <button style={btnSolid} onClick={ship}>Save — starts 28-day measurement</button>
          <button style={btn} onClick={() => setShipOpen(false)}>Cancel</button>
        </div>
      )}
      {err && <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 6 }}>{err}</div>}
    </div>
  );
}

// ── Standalone change logger (work not tied to a recommendation) ──
export function ChangeLogger({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [kw, setKw] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState("");

  async function save() {
    try {
      await track({
        action: "log_change", client_id: clientId, title, description: desc, changed_at: date,
        affected_keywords: kw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
      });
      location.reload();
    } catch (e) { setErr((e as Error).message); }
  }

  if (!open) return <button style={btn} onClick={() => setOpen(true)}>+ Log a change</button>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 0" }}>
      <input style={input} placeholder="What changed (e.g. Rewrote /pages/salt-wash title + content)"
        value={title} onChange={(e) => setTitle(e.target.value)} />
      <input style={input} placeholder="Affected tracked keywords, comma-separated (optional)"
        value={kw} onChange={(e) => setKw(e.target.value)} />
      <textarea style={{ ...input, minHeight: 60, resize: "vertical" }} placeholder="Notes (optional)"
        value={desc} onChange={(e) => setDesc(e.target.value)} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="date" style={input} value={date} onChange={(e) => setDate(e.target.value)} />
        <button style={btnSolid} onClick={save}>Save change</button>
        <button style={btn} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {err && <div style={{ fontSize: 12, color: "var(--danger)" }}>{err}</div>}
    </div>
  );
}
