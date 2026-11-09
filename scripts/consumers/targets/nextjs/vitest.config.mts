// The Next.js consumer runs the default profile of the http suite against `next start`. The hand-written and boot
// profiles wait: their apps and boot variants are Hono-shaped (framework-route checks, mount mismatches) and have no
// Next.js counterpart yet. The Turbopack build test builds the generated tree alone.
import { defineConfig } from "vitest/config";

const BUILD_TIMEOUT_MS = 300_000;

export default defineConfig({
  test: {
    include: ["test/http-suite.test.mts", "test/turbopack-build.test.mts"],
    testTimeout: BUILD_TIMEOUT_MS,
    hookTimeout: BUILD_TIMEOUT_MS,
  },
});
