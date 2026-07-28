// api/ops/anthropic-check — is the key working, and what has it cost?
//
// WO-003 Stream N. Same pattern as every other integration: report each hop
// separately so a missing key, a rejected key and a hit ceiling are three
// different answers rather than one "it didn't work".
//
// Owner-only: this reports commercial spend.
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/supabaseServer";
import { dbClient } from "@/lib/db";
import { spendThisMonth, CEILING_USD, MODEL } from "@/lib/ai";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const profile = await getProfile();
  if (profile?.role !== "owner") {
    return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  }

  const db = dbClient();
  const key = process.env.ANTHROPIC_API_KEY;

  const out: Record<string, unknown> = {
    key_present: !!key,
    // Length only, never the value — the same rule every other ops route follows.
    key_length: key?.length ?? 0,
    model: MODEL,
    monthly_ceiling_usd: CEILING_USD,
  };

  if (!key) {
    return NextResponse.json({
      ok: false, failed_at: "no_key",
      hint: "Set ANTHROPIC_API_KEY in Vercel from the Growth-OS workspace, then redeploy.",
      ...out,
    });
  }

  // Spend from OUR ledger. Anthropic's own figure lives in the Console; this is
  // what the in-app ceiling actually gates on, so it is the number that decides
  // whether the next call is allowed.
  const spent = await spendThisMonth(db);
  out.spent_this_month_usd = Math.round(spent * 10000) / 10000;
  out.headroom_usd = Math.round((CEILING_USD - spent) * 100) / 100;
  out.would_refuse_next_call = spent >= CEILING_USD;

  const { data: recent } = await db
    .from("ai_usage")
    .select("feature, model, input_tokens, output_tokens, cost_usd, ok, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(5);
  out.recent = recent ?? [];

  // Cheapest possible live check that the key is actually accepted. Counting
  // tokens costs nothing and still proves auth end to end.
  try {
    const anthropic = new Anthropic({ apiKey: key });
    const count = await anthropic.messages.countTokens({
      model: MODEL,
      messages: [{ role: "user", content: "ping" }],
    });
    return NextResponse.json({ ok: true, key_accepted: true, probe_tokens: count.input_tokens, ...out });
  } catch (e) {
    const msg = (e as Error).message ?? "";
    return NextResponse.json({
      ok: false,
      failed_at: /401|authentication/i.test(msg) ? "key_rejected" : "api_error",
      error: msg.slice(0, 300),
      ...out,
    }, { status: 500 });
  }
}
