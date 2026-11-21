import { defineConfig } from "vitest/config";

// The vitest run of `node scripts/oracle/cli.ts record`: the unit tests whose `emitDocuments` and `diffContracts`
// calls become converted cases, with `record-setup.ts` noting each call.
export default defineConfig({
  test: {
    include: ["packages/core/openapi/src/**/*.test.ts", "packages/core/diff/src/**/*.test.ts"],
    setupFiles: ["scripts/oracle/record-setup.ts"],
    testTimeout: 30_000,
    pool: "forks",
  },
});
