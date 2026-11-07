// Runs the registry proof's suite against a consumer built from the released artefacts; never part of the
// repository's own test run.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/release/registry-proof/*.suite.ts"],
    testTimeout: 30_000,
  },
});
