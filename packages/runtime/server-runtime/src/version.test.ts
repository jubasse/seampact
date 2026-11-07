import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { SERVER_RUNTIME_VERSION } from "./version.js";

// The checks read the constant, never the manifest; the release that stamps one stamps the other (ADR 0025, G1).
test("the runtime's version constant is its package version", () => {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );

  expect(manifest).toMatchObject({ version: SERVER_RUNTIME_VERSION });
});
