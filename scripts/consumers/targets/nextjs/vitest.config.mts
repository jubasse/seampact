// The Next.js consumer runs the default and hand-written profiles of the http suite against `next start`, and under
// `--pack` the pack's profile in their place. It has no boot profile: Next.js routes by file, so no route scan runs at
// boot (ADR 0030). The Turbopack build test builds the generated tree alone.
import { defineConfig } from "vitest/config";

const BUILD_TIMEOUT_MS = 300_000;

export default defineConfig({
  test: {
    include: [
      "test/http-suite.test.mts",
      "test/http-suite-hand-written.test.mts",
      "test/http-suite-pack.test.mts",
      "test/turbopack-build.test.mts",
    ],
    // One build serves every file: parallel files would each find no build and run `next build` over the same tree.
    fileParallelism: false,
    testTimeout: BUILD_TIMEOUT_MS,
    hookTimeout: BUILD_TIMEOUT_MS,
  },
});
