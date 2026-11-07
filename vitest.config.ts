import { defineConfig } from "vitest/config";

// The default 5 s per test is a wall-clock limit that a loaded machine overruns.
const TEST_TIMEOUT_MILLISECONDS = 30_000;

export default defineConfig({
  test: {
    include: ["packages/*/*/src/**/*.test.ts", "scripts/**/*.test.ts"],
    testTimeout: TEST_TIMEOUT_MILLISECONDS,
    // One process per file: the CPU-time bounds of the loader tests read process-wide CPU usage.
    pool: "forks",
  },
});
