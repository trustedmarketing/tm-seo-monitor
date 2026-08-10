import { describe, it, expect, afterEach, vi } from "vitest";
import {
  AEO_PROVIDERS, DEFAULT_PROVIDERS, enabledProviders, endpointFor, modelFor, providerSpec,
} from "@/lib/aeoProviders";

afterEach(() => { vi.unstubAllEnvs(); });

describe("provider registry", () => {
  it("keeps ChatGPT first so it stays the default and history stays comparable", () => {
    expect(AEO_PROVIDERS[0].key).toBe("chat_gpt");
    expect(DEFAULT_PROVIDERS).toEqual(["chat_gpt"]);
  });

  it("builds the right DataForSEO path per provider", () => {
    expect(endpointFor(providerSpec("chat_gpt")!)).toBe("/ai_optimization/chat_gpt/llm_responses/live");
    expect(endpointFor(providerSpec("gemini")!)).toBe("/ai_optimization/gemini/llm_responses/live");
    expect(endpointFor(providerSpec("claude")!)).toBe("/ai_optimization/claude/llm_responses/live");
  });

  it("returns null for an unknown provider rather than building a bogus URL", () => {
    expect(providerSpec("bard")).toBeNull();
  });
});

describe("modelFor", () => {
  it("falls back to the provider's default", () => {
    vi.stubEnv("AEO_MODEL_GEMINI", "");
    expect(modelFor(providerSpec("gemini")!)).toBe("gemini-2.0-flash");
  });

  it("lets an env var override it — DataForSEO rolls model names forward", () => {
    vi.stubEnv("AEO_MODEL_CLAUDE", "claude-opus-4-1");
    expect(modelFor(providerSpec("claude")!)).toBe("claude-opus-4-1");
  });

  it("each provider reads its own env var, not a shared one", () => {
    vi.stubEnv("AEO_MODEL", "gpt-5");
    vi.stubEnv("AEO_MODEL_GEMINI", "");
    expect(modelFor(providerSpec("chat_gpt")!)).toBe("gpt-5");
    expect(modelFor(providerSpec("gemini")!)).toBe("gemini-2.0-flash");
  });
});

describe("enabledProviders", () => {
  it("returns the client's configured providers", () => {
    expect(enabledProviders(["chat_gpt", "gemini"]).map((p) => p.key)).toEqual(["chat_gpt", "gemini"]);
  });

  it("orders by the registry, not by however the column happens to be stored", () => {
    expect(enabledProviders(["claude", "chat_gpt"]).map((p) => p.key)).toEqual(["chat_gpt", "claude"]);
  });

  it("drops unknown values instead of passing them into a URL path", () => {
    expect(enabledProviders(["chat_gpt", "bard", "../etc/passwd"]).map((p) => p.key)).toEqual(["chat_gpt"]);
  });

  it("dedupes", () => {
    expect(enabledProviders(["gemini", "gemini"]).map((p) => p.key)).toEqual(["gemini"]);
  });

  it("falls back to the default rather than checking NOTHING when empty or malformed", () => {
    // Degrading to zero providers would silently stop collecting AEO data with
    // no error — the same shape of failure as the crawl bug. Degrade to the old
    // behaviour instead.
    for (const bad of [[], null, undefined, "chat_gpt", 42, ["nope"]]) {
      expect(enabledProviders(bad).map((p) => p.key)).toEqual(["chat_gpt"]);
    }
  });
});
