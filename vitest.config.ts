import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Two test tiers:
//   tests/unit/    — deterministic, no network/creds. Run by `npm test` and CI.
//   tests/staging/ — live integration against tm-growth-staging with MOCK_APIS=1.
//                    Run by `npm run test:staging` (loads .env.staging.local). Never in CI.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // staging smoke does many sequential round-trips to Supabase; unit tests are fast.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
