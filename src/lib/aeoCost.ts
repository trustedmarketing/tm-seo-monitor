// lib/aeoCost.ts — what the AI answer checks actually cost per month.
//
// Same reasoning as api/ops/dataforseo-check itself: "crawls cost money" was
// asserted in the UI with no number behind it, and a cost warning nobody can
// verify is just anxiety. Enabling a second AEO provider is a bigger spend
// decision than a crawl, so it should not be made blind either.
//
// DataForSEO charges $0.0006 per LLM Responses task PLUS whatever the model
// itself bills — so the markup is rounding error and the MODEL CHOICE is the
// entire cost. The spread across models is roughly two orders of magnitude,
// which is why this is a table and not a single number.

/** DataForSEO's own per-task fee for llm_responses live. */
export const DFS_TASK_FEE = 0.0006;

/**
 * Estimated LLM passthrough cost for one check, in USD.
 *
 * Deliberately approximate and deliberately conservative (rounded UP). These
 * are token prices for a ~2k-token answer with web search on, and they move —
 * the point is to make the ORDER OF MAGNITUDE visible so nobody enables Opus
 * across a portfolio without seeing the difference, not to invoice anyone.
 * Treat a projection as "which bracket am I in", never as a bill.
 */
export const MODEL_COST: Record<string, number> = {
  // OpenAI
  "gpt-4o": 0.02,
  "gpt-4o-mini": 0.002,
  "gpt-4.1": 0.02,
  "gpt-4.1-mini": 0.002,
  // Google — cheapest by a wide margin
  "gemini-2.0-flash": 0.001,
  "gemini-2.5-flash": 0.001,
  "gemini-2.5-pro": 0.02,
  // Anthropic — Opus is the expensive one, and it is what DataForSEO's own
  // docs example shows, which is exactly how it ends up chosen by accident.
  "claude-opus-4-0": 0.15,
  "claude-sonnet-4-0": 0.03,
  "claude-haiku-4-0": 0.004,
};

/** Unknown models fall back to a deliberately pessimistic figure — a surprise
 *  that is cheaper than projected is fine; the reverse is what hurts. */
export const UNKNOWN_MODEL_COST = 0.05;

export function costPerCheck(model: string): { usd: number; known: boolean } {
  const known = Object.prototype.hasOwnProperty.call(MODEL_COST, model);
  return { usd: (known ? MODEL_COST[model] : UNKNOWN_MODEL_COST) + DFS_TASK_FEE, known };
}

/** Runs per month for a frequency, matching the cron's own FREQ_DAYS table. */
export function runsPerMonth(frequency: string | null | undefined): number {
  const days: Record<string, number> = { daily: 1, weekly: 7, biweekly: 14, monthly: 28 };
  if (!frequency || frequency === "paused") return 0;
  return 30 / (days[frequency] ?? 7);
}

export interface ProviderProjection {
  provider: string;
  model: string;
  costPerCheck: number;
  /** False when the model isn't in the table, so the figure is a guess. */
  modelPriceKnown: boolean;
  monthlyUsd: number;
}

export interface ClientProjection {
  client: string;
  prompts: number;
  /** AI checks follow serp_frequency — they share its cadence gate in the cron. */
  frequency: string | null;
  runsPerMonth: number;
  providers: ProviderProjection[];
  monthlyUsd: number;
}

export function projectClient(input: {
  client: string;
  prompts: number;
  frequency: string | null;
  providers: { key: string; model: string }[];
}): ClientProjection {
  const runs = runsPerMonth(input.frequency);
  const providers = input.providers.map((p) => {
    const { usd, known } = costPerCheck(p.model);
    return {
      provider: p.key,
      model: p.model,
      costPerCheck: usd,
      modelPriceKnown: known,
      monthlyUsd: round(usd * input.prompts * runs),
    };
  });
  return {
    client: input.client,
    prompts: input.prompts,
    frequency: input.frequency,
    runsPerMonth: round(runs),
    providers,
    monthlyUsd: round(providers.reduce((a, p) => a + p.monthlyUsd, 0)),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
