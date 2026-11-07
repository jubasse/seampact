import { defineConfig } from "vitest/config";

// The default 5 s per test is a wall-clock limit that a loaded machine overruns.
const TEST_TIMEOUT_MILLISECONDS = 30_000;

export default defineConfig({
  test: {
    include: ["packages/*/*/src/**/*.test.ts", "scripts/**/*.test.ts"],
    testTimeout: TEST_TIMEOUT_MILLISECONDS,
    // One process per file: the CPU-time bounds of the loader tests read process-wide CPU usage.
    pool: "forks",
    // Off unless `--coverage` asks for it; CI checks the summary against `scripts/coverage-floors/floors.json`.
    coverage: {
      provider: "v8",
      include: ["packages/*/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*test-support.ts", "**/*.d.ts", "packages/tools/docs-site/**"],
      reporter: ["json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
