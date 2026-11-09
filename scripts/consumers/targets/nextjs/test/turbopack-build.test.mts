// Builds an app that holds the generated tree alone with `next build` under Turbopack, Next.js 16's default
// bundler: the generated imports are extensionless because Turbopack does not map a `.js` specifier to its `.ts`
// source. The http suite's app builds with webpack, since it imports the shared `.mts` samples.
import { join } from "node:path";
import { expect, test } from "vitest";
import { CONSUMER_ROOT, runNext } from "./server.mjs";

const BUILD_TIMEOUT_MS = 300_000;

test(
  "the generated tree builds under Turbopack",
  async () => {
    await expect(runNext(["build"], join(CONSUMER_ROOT, "turbopack-app"))).resolves.toBeUndefined();
  },
  BUILD_TIMEOUT_MS,
);
