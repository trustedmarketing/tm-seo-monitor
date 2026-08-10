// lib/aeoProviders.ts — which AI assistants we check brand visibility in.
//
// "AEO" was ChatGPT-only, which quietly answered a narrower question than the
// section's title claimed: a brand absent from ChatGPT but cited by Gemini is
// visible in AI answers, and a 0% that only ever asked one model cannot tell
// those apart.
//
// DataForSEO exposes one endpoint per provider under /ai_optimization/<slug>/
// with an identical request shape, so the provider is data, not three code
// paths. Adding Perplexity later is a line in this table.
//
// Model names are env-overridable per provider because DataForSEO resolves
// short names to dated versions server-side (claude-opus-4-0 →
// claude-opus-4-20250514) and those roll forward. A hardcoded name that rots
// would fail the whole provider; an env override plus /api/ops/aeo-models means
// it can be corrected without guessing.
export type AeoProvider = "chat_gpt" | "gemini" | "claude";

export interface ProviderSpec {
  key: AeoProvider;
  /** Shown in the UI. */
  label: string;
  /** DataForSEO path segment. */
  slug: string;
  defaultModel: string;
  envVar: string;
}

export const AEO_PROVIDERS: ProviderSpec[] = [
  { key: "chat_gpt", label: "ChatGPT", slug: "chat_gpt", defaultModel: "gpt-4o", envVar: "AEO_MODEL" },
  { key: "gemini", label: "Gemini", slug: "gemini", defaultModel: "gemini-2.0-flash", envVar: "AEO_MODEL_GEMINI" },
  // Sonnet, not Opus. DataForSEO's own docs example uses claude-opus-4-0, which
  // is how the most expensive model in the range ends up chosen by accident —
  // the LLM cost is passed straight through, and Opus runs roughly 5x Sonnet
  // and ~100x Gemini Flash per check. For "was this brand named in the answer"
  // the frontier model buys nothing the cheaper one does not already do.
  { key: "claude", label: "Claude", slug: "claude", defaultModel: "claude-sonnet-4-0", envVar: "AEO_MODEL_CLAUDE" },
];

/**
 * The provider every client gets. ChatGPT stays the default because it is what
 * the section has always measured — switching the baseline would make today's
 * numbers incomparable with the history already collected.
 */
export const DEFAULT_PROVIDERS: AeoProvider[] = ["chat_gpt"];

export function providerSpec(key: string): ProviderSpec | null {
  return AEO_PROVIDERS.find((p) => p.key === key) ?? null;
}

export function modelFor(spec: ProviderSpec): string {
  return process.env[spec.envVar] || spec.defaultModel;
}

export function endpointFor(spec: ProviderSpec): string {
  return `/ai_optimization/${spec.slug}/llm_responses/live`;
}

/**
 * A client's enabled providers, from `clients.aeo_providers`.
 *
 * Every extra provider is a separate billed call per prompt per run, so this is
 * opt-in per client rather than on for everyone — the DataForSEO balance is
 * shared across every module, and silently tripling AEO spend would starve the
 * collectors that revenue reporting depends on.
 *
 * Unknown values are dropped rather than passed through to a URL. An empty or
 * malformed column falls back to the default rather than checking nothing,
 * because "no providers configured" should degrade to the old behaviour, not to
 * a silent gap in the data.
 */
export function enabledProviders(raw: unknown): ProviderSpec[] {
  const list = Array.isArray(raw) ? raw : null;
  const valid = (list ?? [])
    .map((v) => (typeof v === "string" ? providerSpec(v) : null))
    .filter((p): p is ProviderSpec => p !== null);

  if (valid.length === 0) {
    return DEFAULT_PROVIDERS.map((k) => providerSpec(k)).filter((p): p is ProviderSpec => p !== null);
  }
  // Dedupe while keeping AEO_PROVIDERS' order, so the UI reads consistently
  // regardless of what order the column happens to hold.
  return AEO_PROVIDERS.filter((p) => valid.some((v) => v.key === p.key));
}
