import { describe, it, expect } from "vitest";
import {
  DFS_TASK_FEE, MODEL_COST, UNKNOWN_MODEL_COST, costPerCheck, projectClient, runsPerMonth,
} from "@/lib/aeoCost";

describe("costPerCheck", () => {
  it("adds DataForSEO's per-task fee on top of the model's own cost", () => {
    const { usd } = costPerCheck("gpt-4o");
    expect(usd).toBeCloseTo(MODEL_COST["gpt-4o"] + DFS_TASK_FEE);
  });

  it("prices an unknown model pessimistically and flags it as a guess", () => {
    // A projection that under-reports is the one that hurts: nobody minds a
    // bill smaller than forecast.
    const r = costPerCheck("some-model-shipped-next-year");
    expect(r.known).toBe(false);
    expect(r.usd).toBeCloseTo(UNKNOWN_MODEL_COST + DFS_TASK_FEE);
  });

  it("prices Opus far above Sonnet, and Gemini Flash far below both", () => {
    // The whole reason this table exists — the spread is ~100x, so the model
    // choice is nearly the entire bill and must be visible before it's made.
    const opus = costPerCheck("claude-opus-4-0").usd;
    const sonnet = costPerCheck("claude-sonnet-4-0").usd;
    const flash = costPerCheck("gemini-2.0-flash").usd;
    expect(opus).toBeGreaterThan(sonnet * 3);
    expect(sonnet).toBeGreaterThan(flash * 10);
  });
});

describe("runsPerMonth", () => {
  it("matches the cron's own cadence table", () => {
    expect(runsPerMonth("daily")).toBe(30);
    expect(runsPerMonth("weekly")).toBeCloseTo(30 / 7);
    expect(runsPerMonth("monthly")).toBeCloseTo(30 / 28);
  });

  it("counts a paused client as zero rather than defaulting to weekly", () => {
    expect(runsPerMonth("paused")).toBe(0);
    expect(runsPerMonth(null)).toBe(0);
  });

  it("falls back to weekly for an unrecognised frequency", () => {
    expect(runsPerMonth("fortnightly-ish")).toBeCloseTo(30 / 7);
  });
});

describe("projectClient", () => {
  it("multiplies prompts × runs × per-check cost, per provider", () => {
    const p = projectClient({
      client: "Salty Dog",
      prompts: 30,
      frequency: "daily",
      providers: [{ key: "gemini", model: "gemini-2.0-flash" }],
    });
    // 30 prompts × 30 runs × (0.001 + 0.0006)
    expect(p.providers[0].monthlyUsd).toBeCloseTo(30 * 30 * 0.0016, 2);
    expect(p.monthlyUsd).toBeCloseTo(p.providers[0].monthlyUsd, 2);
  });

  it("shows Opus daily as the runaway it is", () => {
    const p = projectClient({
      client: "Salty Dog",
      prompts: 30,
      frequency: "daily",
      providers: [{ key: "claude", model: "claude-opus-4-0" }],
    });
    // Well over $100/month for ONE client on ONE provider — the number that
    // makes the case for not defaulting to Opus.
    expect(p.monthlyUsd).toBeGreaterThan(100);
  });

  it("sums across providers", () => {
    const p = projectClient({
      client: "X",
      prompts: 10,
      frequency: "weekly",
      providers: [
        { key: "chat_gpt", model: "gpt-4o" },
        { key: "gemini", model: "gemini-2.0-flash" },
      ],
    });
    expect(p.monthlyUsd).toBeCloseTo(p.providers[0].monthlyUsd + p.providers[1].monthlyUsd, 2);
  });

  it("costs nothing for a client with no prompts", () => {
    const p = projectClient({ client: "X", prompts: 0, frequency: "daily", providers: [{ key: "chat_gpt", model: "gpt-4o" }] });
    expect(p.monthlyUsd).toBe(0);
  });

  it("costs nothing for a paused client, however many prompts it has", () => {
    const p = projectClient({ client: "X", prompts: 500, frequency: "paused", providers: [{ key: "chat_gpt", model: "gpt-4o" }] });
    expect(p.monthlyUsd).toBe(0);
  });
});
