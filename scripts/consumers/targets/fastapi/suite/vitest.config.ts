// Runs the http suite against the assembled FastAPI consumer; never part of the repository's own test run.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/consumers/targets/fastapi/suite/*.suite.ts"],
    testTimeout: 30_000,
  },
});
