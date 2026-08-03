"use client";
// app/admin/page.tsx — manage clients, keywords, suggestions, GSC backfill.
// Gated by ADMIN_PASSWORD (entered once, held in memory for the session).

import { useEffect, useState, useCallback } from "react";
import "@/styles/tm-tokens.css";

type Client = {
  id: string; name: string; domain: string; tier: string | null;
  location_code: number; gsc_property: string | null;
  core_frequency: string; serp_frequency: string; crawl_frequency: string;
  client_type: string | null; ga4_property_id: string | null;
  service_areas: Array<{ city?: string; location_code?: number }> | null;
};
type Keyword = { id: string; client_id: string; keyword: string };
type Prompt = { id: string; client_id: string; prompt: string };
type Suggestion = { keyword: string; source: string; note: string };

const FREQS = ["daily", "weekly", "biweekly", "monthly", "paused"];
const TIERS = ["", "Consistency", "Momentum", "Dominate"];
const TYPES: Array<[string, string]> = [
  ["", "Unclassified"],
  ["local_service", "Local service"],
  ["national_ecom", "National eCommerce"],
  ["hybrid", "Hybrid"],
];

const S = {
  input: {
    fontFamily: "var(--font-body)", fontSize: 14, padding: "9px 12px",
    border: "1px solid var(--border-strong)", borderRadius: 8,
    background: "#fff", color: "var(--fg1)", outline: "none", width: "100%",
  } as React.CSSProperties,
  btn: {
    fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 14,
    padding: "10px 16px", borderRadius: 8, border: "1px solid transparent",
    cursor: "pointer", background: "var(--tm-performance-green)", color: "#080808",
  } as React.CSSProperties,
  btnGhost: {
    fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 13,
    padding: "8px 14px", borderRadius: 8, cursor: "pointer",
    background: "transparent", color: "#080808", border: "1px solid var(--border-strong)",
  } as React.CSSProperties,
  label: {
    fontSize: 11, fontWeight: 600, letterSpacing: "0.12em",
    textTransform: "uppercase", color: "var(--fg2)", marginBottom: 6, display: "block",
  } as React.CSSProperties,
  card: {
    background: "#fff", border: "1px solid var(--border)", borderRadius: 12,
    padding: 24, boxShadow: "var(--shadow-sm)",
  } as React.CSSProperties,
};

export default function Admin() {
  const [pw, setPw] = useState("");
  const [authed, setAuthed] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [kwInput, setKwInput] = useState("");
  const [promptInput, setPromptInput] = useState("");
  const [gscInput, setGscInput] = useState<string | null>(null);
  const [locInput, setLocInput] = useState<string | null>(null);
  const [areasInput, setAreasInput] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [form, setForm] = useState<Partial<Client>>({});

  const api = useCallback(async (body?: Record<string, unknown>) => {
    const res = await fetch("/api/admin", {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${pw}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { setAuthed(false); throw new Error("Wrong password"); }
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  }, [pw]);

  const load = useCallback(async () => {
    const { clients, keywords, prompts } = await api();
    setClients(clients); setKeywords(keywords); setPrompts(prompts ?? []); setAuthed(true);
  }, [api]);

  useEffect(() => { /* wait for password */ }, []);

  async function run(label: string, fn: () => Promise<void>) {
    setStatus(label + "…");
    try { await fn(); setStatus(""); }
    catch (e) { setStatus(`${label} failed: ${(e as Error).message}`); }
  }

  if (!authed) {
    return (
      <main style={{ fontFamily: "var(--font-body)", background: "var(--bg)", minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <div style={{ ...S.card, width: 340 }}>
          <div style={S.label}>Admin password</div>
          <input type="password" style={S.input} value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run("Sign in", load)} />
          <button style={{ ...S.btn, marginTop: 12, width: "100%" }}
            onClick={() => run("Sign in", load)}>Open admin</button>
          {status && <div style={{ fontSize: 13, color: "var(--danger)", marginTop: 10 }}>{status}</div>}
        </div>
      </main>
    );
  }

  const sel = clients.find((c) => c.id === selected) ?? null;
  const selKeywords = keywords.filter((k) => k.client_id === selected);
  const selPrompts = prompts.filter((p) => p.client_id === selected);

  return (
    <main style={{ fontFamily: "var(--font-body)", background: "var(--bg)", minHeight: "100vh", padding: "48px 24px", color: "var(--fg1)" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 44, margin: "0 0 32px" }}>
          Clients <em style={{ color: "var(--tm-green-deep)" }}>admin</em>
        </h1>
        {status && <div style={{ fontSize: 13, marginBottom: 16, color: status.includes("failed") ? "var(--danger)" : "var(--fg2)" }}>{status}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 24, alignItems: "start" }}>
          {/* ── Client list + add form ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={S.card}>
              <div style={S.label}>Add client</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input style={S.input} placeholder="Name" value={form.name ?? ""}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <input style={S.input} placeholder="domain.com" value={form.domain ?? ""}
                  onChange={(e) => setForm({ ...form, domain: e.target.value })} />
                <select style={S.input} value={form.tier ?? ""}
                  onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                  {TIERS.map((t) => <option key={t} value={t}>{t || "No tier"}</option>)}
                </select>
                {/* Classify at creation. Left null the workspace falls back to the
                    universal tab set, so Revenue and GBP are decided by nobody. */}
                <select style={S.input} value={form.client_type ?? ""}
                  onChange={(e) => setForm({ ...form, client_type: e.target.value })}>
                  {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <input style={S.input} placeholder="GSC property (sc-domain:domain.com)" value={form.gsc_property ?? ""}
                  onChange={(e) => setForm({ ...form, gsc_property: e.target.value })} />
                <input style={S.input} placeholder="GA4 property ID (539468239)" value={form.ga4_property_id ?? ""}
                  onChange={(e) => setForm({ ...form, ga4_property_id: e.target.value })} />
                {/* 2840 is the whole United States. For a local client that tracks
                    national rankings for a business competing in one metro, and
                    the numbers look plausible either way. */}
                <input style={S.input} placeholder="DataForSEO location code (2840 = US)"
                  value={form.location_code ?? ""}
                  onChange={(e) => setForm({ ...form, location_code: e.target.value as unknown as number })} />
                <button style={S.btn} onClick={() => run("Add client", async () => {
                  await api({ action: "upsert_client", ...form });
                  setForm({}); await load();
                })}>Add client</button>
              </div>
            </div>

            <div style={{ ...S.card, padding: 12 }}>
              {clients.map((c) => (
                <button key={c.id} onClick={() => {
                    setSelected(c.id); setSuggestions([]);
                    setGscInput(null); setLocInput(null); setAreasInput(null);
                  }}
                  style={{
                    display: "flex", width: "100%", alignItems: "center", gap: 8,
                    padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                    background: c.id === selected ? "var(--tm-deep-charcoal)" : "transparent",
                    color: c.id === selected ? "#fff" : "var(--fg1)",
                    fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 600, textAlign: "left",
                  }}>
                  {c.name}
                  {/* Migration 013 leaves client_type null rather than guessing, on the
                      condition that /admin keeps the gap visible. This is that. */}
                  {!c.client_type && (
                    <span title="No client type — the workspace falls back to the universal tab set"
                      style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                               padding: "2px 7px", borderRadius: 999, border: "1px solid var(--border-strong)",
                               color: c.id === selected ? "#fff" : "var(--fg3)" }}>
                      unclassified
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: c.id === selected ? "var(--tm-performance-green)" : "var(--fg3)" }}>
                    {keywords.filter((k) => k.client_id === c.id).length} kw
                  </span>
                </button>
              ))}
              {clients.length === 0 && <div style={{ padding: 12, fontSize: 13, color: "var(--fg3)" }}>No clients yet. Add the first one above.</div>}
            </div>
          </div>

          {/* ── Selected client detail ── */}
          {sel ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={S.card}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <span style={{ fontSize: 17, fontWeight: 600 }}>{sel.name}</span>
                  <span style={{ fontSize: 13, color: "var(--fg3)" }}>{sel.domain}</span>
                  {/* Credentials, GA4, ClickUp and the store connections live on the
                      client's own Settings screen — this page never sees a secret. */}
                  <a href={`/dashboard/${sel.id}/settings`} target="_blank" rel="noreferrer"
                    style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600, color: "var(--fg2)" }}>
                    Connections &amp; credentials ↗
                  </a>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                  {(["core_frequency", "serp_frequency", "crawl_frequency"] as const).map((f) => (
                    <div key={f}>
                      <label style={S.label}>{f.replace("_frequency", "")}</label>
                      <select style={S.input} value={sel[f]}
                        onChange={(e) => run("Update frequency", async () => {
                          // Send only what changed. Resending the whole client from
                          // this page's copy would revert anything Settings changed
                          // in another tab.
                          await api({ action: "upsert_client", id: sel.id, [f]: e.target.value });
                          await load();
                        })}>
                        {FREQS.map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16 }}>
                  <label style={S.label}>GSC property (exactly as shown in Search Console: sc-domain:client.com or https://client.com/)</label>
                  <div style={{ display: "flex", gap: 10 }}>
                    <input style={S.input} value={gscInput ?? sel.gsc_property ?? ""}
                      placeholder="sc-domain:client.com"
                      onChange={(e) => setGscInput(e.target.value)} />
                    <button style={S.btnGhost} onClick={() => run("Save GSC property", async () => {
                      await api({ action: "upsert_client", id: sel.id, gsc_property: (gscInput ?? sel.gsc_property ?? "").trim() });
                      setGscInput(null); await load();
                    })}>Save</button>
                  </div>
                </div>

                {/* Rank-tracking geography. No other screen writes these, and the
                    default (2840, the whole US) is wrong for every local client. */}
                <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, marginTop: 16, alignItems: "start" }}>
                  <div>
                    <label style={S.label}>Location code</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input style={S.input} value={locInput ?? String(sel.location_code ?? "")}
                        onChange={(e) => setLocInput(e.target.value)} />
                      <button style={S.btnGhost} onClick={() => run("Save location", async () => {
                        await api({ action: "upsert_client", id: sel.id, location_code: locInput ?? sel.location_code });
                        setLocInput(null); await load();
                      })}>Save</button>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--fg3)", marginTop: 5 }}>2840 = United States.</div>
                  </div>
                  <div>
                    <label style={S.label}>Service areas — one per line, &ldquo;City, ST | location_code&rdquo;</label>
                    <textarea style={{ ...S.input, minHeight: 72, resize: "vertical", fontFamily: "var(--font-body)" }}
                      placeholder={"Dallas, TX | 1026339\nFort Worth, TX | 1026460"}
                      value={areasInput ?? (sel.service_areas ?? []).map((a) => `${a.city} | ${a.location_code}`).join("\n")}
                      onChange={(e) => setAreasInput(e.target.value)} />
                    <button style={{ ...S.btnGhost, marginTop: 8 }} onClick={() => run("Save service areas", async () => {
                      await api({ action: "upsert_client", id: sel.id, service_areas: areasInput ?? "" });
                      setAreasInput(null); await load();
                    })}>Save areas</button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button style={S.btnGhost} onClick={() => run("Suggest keywords", async () => {
                    const r = await api({ action: "suggest_keywords", client_id: sel.id });
                    setSuggestions(r.suggestions);
                    if (r.gsc_error) setStatus(`GSC unavailable: ${r.gsc_error}`);
                  })}>Suggest keywords</button>
                  <button style={S.btnGhost} onClick={() => run("GSC backfill", async () => {
                    const r = await api({ action: "gsc_backfill", client_id: sel.id });
                    setStatus(`Backfilled ${r.backfilled_days} days of GSC history`);
                  })}>Backfill GSC history</button>
                </div>
              </div>

              <div style={S.card}>
                <div style={S.label}>Tracked keywords ({selKeywords.length})</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "10px 0 16px" }}>
                  {selKeywords.map((k) => (
                    <span key={k.id} style={{
                      display: "inline-flex", alignItems: "center", gap: 8,
                      fontSize: 13, fontWeight: 600, padding: "5px 12px",
                      borderRadius: 999, border: "1px solid var(--border-strong)",
                    }}>
                      {k.keyword}
                      <button onClick={() => run("Remove", async () => {
                        await api({ action: "remove_keyword", keyword_id: k.id }); await load();
                      })} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--fg3)", padding: 0 }}>×</button>
                    </span>
                  ))}
                </div>
                <label style={S.label}>Add keywords (one per line)</label>
                <textarea style={{ ...S.input, minHeight: 90, resize: "vertical" }} value={kwInput}
                  onChange={(e) => setKwInput(e.target.value)} />
                <button style={{ ...S.btn, marginTop: 10 }} onClick={() => run("Add keywords", async () => {
                  await api({ action: "add_keywords", client_id: sel.id, keywords: kwInput.split("\n") });
                  setKwInput(""); await load();
                })}>Add keywords</button>
              </div>

              <div style={S.card}>
                <div style={S.label}>AI prompts ({selPrompts.length})</div>
                <div style={{ fontSize: 13, color: "var(--fg3)", margin: "6px 0 10px", lineHeight: 1.5 }}>
                  Questions a customer would ask an AI assistant. Each is run through an LLM on the
                  same schedule as rank tracking; AI Visibility = share of prompts where this client appears.
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 16px" }}>
                  {selPrompts.map((p) => (
                    <span key={p.id} style={{
                      display: "inline-flex", alignItems: "center", gap: 8,
                      fontSize: 13, fontWeight: 600, padding: "5px 12px",
                      borderRadius: 999, border: "1px solid var(--border-strong)",
                    }}>
                      {p.prompt}
                      <button onClick={() => run("Remove", async () => {
                        await api({ action: "remove_prompt", prompt_id: p.id }); await load();
                      })} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--fg3)", padding: 0 }}>×</button>
                    </span>
                  ))}
                </div>
                <label style={S.label}>Add prompts (one per line)</label>
                <textarea style={{ ...S.input, minHeight: 90, resize: "vertical" }} value={promptInput}
                  placeholder={"what's the best salt remover for boats\nhow do I stop salt corrosion on my boat trailer"}
                  onChange={(e) => setPromptInput(e.target.value)} />
                <button style={{ ...S.btn, marginTop: 10 }} onClick={() => run("Add prompts", async () => {
                  await api({ action: "add_prompts", client_id: sel.id, prompts: promptInput.split("\n") });
                  setPromptInput(""); await load();
                })}>Add prompts</button>
              </div>

              {suggestions.length > 0 && (
                <div style={S.card}>
                  <div style={S.label}>Suggestions — click to add</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                    {suggestions.map((s) => (
                      <button key={s.keyword} onClick={() => run("Add keyword", async () => {
                        await api({ action: "add_keywords", client_id: sel.id, keywords: [s.keyword] });
                        setSuggestions(suggestions.filter((x) => x.keyword !== s.keyword));
                        await load();
                      })} style={{
                        display: "flex", alignItems: "center", gap: 10, width: "100%",
                        padding: "9px 12px", borderRadius: 8, cursor: "pointer", textAlign: "left",
                        background: "var(--tm-stone-100)", border: "1px solid var(--border)",
                        fontFamily: "var(--font-body)", fontSize: 14,
                      }}>
                        <span style={{ fontWeight: 600 }}>{s.keyword}</span>
                        <span style={{ fontSize: 12, color: "var(--fg3)" }}>{s.note}</span>
                        <span style={{
                          marginLeft: "auto", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                          textTransform: "uppercase", padding: "2px 8px", borderRadius: 999,
                          background: s.source === "gsc" ? "var(--tm-deep-charcoal)" : "transparent",
                          color: s.source === "gsc" ? "var(--tm-performance-green)" : "var(--fg2)",
                          border: s.source === "gsc" ? "none" : "1px solid var(--border-strong)",
                        }}>{s.source}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ ...S.card, color: "var(--fg3)", fontSize: 14 }}>
              Select a client to manage keywords, frequencies, and GSC history.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
