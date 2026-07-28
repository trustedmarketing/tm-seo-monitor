// lib/ai.ts — Claude access with a ledger and a hard ceiling.
//
// WO-003. Two controls, doing different jobs:
//
//   Anthropic's workspace limit is the OUTER guard. It is enforced by Anthropic,
//   survives any bug in this codebase, and is the one that actually protects the
//   card. Set on the Growth-OS workspace in the Console.
//
//   This module is the INNER guard. It refuses before spending rather than after,
//   which means a runaway loop stops on our side and is visible in our own data
//   rather than only on a bill at the end of the month.
//
// The realistic per-call cost here is fractions of a cent. That is exactly why
// the ceiling exists: at these prices nobody would notice a loop from the
// spending alone until it had run for a very long time.
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mockApis } from "@/lib/apiMock";

/** Opus 5. Client-facing copy is not where to save a fraction of a cent. */
export const MODEL = "claude-opus-5";

/** USD per million tokens, from Anthropic's published pricing for this model. */
const PRICE = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

/**
 * Monthly ceiling, in dollars, across every feature.
 *
 * Deliberately generous against a projected spend of well under a dollar. It is
 * a runaway guard, not a budget — a limit tight enough to bite during normal use
 * would just get raised the first time it fired, and then be ignored.
 */
const MONTHLY_CEILING_USD = Number(process.env.AI_MONTHLY_CEILING_USD ?? 25);

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
};

export function costOf(u: Omit<Usage, "costUsd">): number {
  return (
    (u.inputTokens * PRICE.input +
      u.outputTokens * PRICE.output +
      u.cacheReadTokens * PRICE.cacheRead +
      u.cacheWriteTokens * PRICE.cacheWrite) / 1_000_000
  );
}

/** Spend so far this calendar month, matching how Anthropic bills. */
export async function spendThisMonth(db: SupabaseClient): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  const { data } = await db
    .from("ai_usage").select("cost_usd").gte("created_at", start.toISOString());

  return (data ?? []).reduce((a, r: { cost_usd: number }) => a + Number(r.cost_usd ?? 0), 0);
}

export class BudgetExceededError extends Error {
  constructor(spent: number) {
    super(
      `AI monthly ceiling reached: $${spent.toFixed(2)} of $${MONTHLY_CEILING_USD}. ` +
      `Raise AI_MONTHLY_CEILING_USD once you have checked why spend is this high.`
    );
    this.name = "BudgetExceededError";
  }
}

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey });
}

type GenerateArgs = {
  db: SupabaseClient;
  feature: string;
  clientId?: string | null;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  /** Thinking counts toward this, so leave headroom above the answer's length. */
  maxTokens?: number;
};

/**
 * One structured generation, metered.
 *
 * Notes on the settings, since each is a cost or correctness decision:
 *
 * · effort "low" — a caption is short and mechanical. Thinking stays ON rather
 *   than disabled: with it off, Opus 5 occasionally writes a tool call into its
 *   visible text or leaks reasoning tags, and low effort gets the same saving
 *   without either failure mode.
 * · structured output — the caller gets a validated object rather than prose it
 *   has to parse. Parsing model output with a regex is how a stray sentence ends
 *   up in a client's caption.
 * · cache_control on the system prompt — brand voice is identical across every
 *   caption for a client, and cache reads are a tenth of the input price.
 */
export async function generate<T>(args: GenerateArgs): Promise<{ value: T; usage: Usage }> {
  const { db, feature, clientId, system, prompt, schema, maxTokens = 2000 } = args;

  // Refuse BEFORE spending. Checking afterwards would tell us we blew the
  // ceiling, which is a report rather than a control.
  const spent = await spendThisMonth(db);
  if (spent >= MONTHLY_CEILING_USD) {
    await db.from("ai_usage").insert({
      client_id: clientId ?? null, feature, model: MODEL,
      ok: false, detail: `refused: monthly ceiling ($${spent.toFixed(2)})`,
    });
    throw new BudgetExceededError(spent);
  }

  if (mockApis()) {
    return {
      value: { caption: "Mock caption.", hashtags: ["#mock"] } as unknown as T,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
    };
  }

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
  });

  // A refusal is a successful HTTP response with an empty or partial body.
  // Reading content[0] without checking is how that becomes a crash.
  if (res.stop_reason === "refusal") {
    await db.from("ai_usage").insert({
      client_id: clientId ?? null, feature, model: MODEL,
      ok: false, detail: "model declined the request",
    });
    throw new Error("Claude declined this request");
  }

  const u: Usage = {
    inputTokens: res.usage.input_tokens ?? 0,
    outputTokens: res.usage.output_tokens ?? 0,
    cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
    costUsd: 0,
  };
  u.costUsd = costOf(u);

  // Ledger first, so spend is recorded even if parsing the answer fails.
  await db.from("ai_usage").insert({
    client_id: clientId ?? null, feature, model: MODEL,
    input_tokens: u.inputTokens, output_tokens: u.outputTokens,
    cache_read_tokens: u.cacheReadTokens, cache_write_tokens: u.cacheWriteTokens,
    cost_usd: u.costUsd, ok: true,
  });

  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No text in Claude response");

  return { value: JSON.parse(text.text) as T, usage: u };
}

export const CEILING_USD = MONTHLY_CEILING_USD;
