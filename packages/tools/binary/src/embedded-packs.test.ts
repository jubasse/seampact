import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PACKS_DIRECTORY = join(SOURCE_DIRECTORY, "../../../packs");

// The module imports `.yaml` files as text, which the test runner cannot load: the list is read as source text.
describe("EMBEDDED_PACKS", () => {
  it("names every first-party pack package", () => {
    const source = readFileSync(join(SOURCE_DIRECTORY, "embedded-packs.ts"), "utf8");
    const embedded = [...source.matchAll(/embeddedPackage\(\s*"([^"]+)"/g)].map(
      (match) => match[1],
    );
    const onDisk = readdirSync(PACKS_DIRECTORY).map((directory) => `@seampact/${directory}`);

    expect(embedded.sort()).toEqual(onDisk.sort());
  });
});
