import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { REFUSED_SCHEMA_KEYWORDS, SCHEMA_KEYWORDS } from "./keywords.js";
import { authoringSchemas } from "./schemas.js";

// The 2020-12 vocabularies, read from the meta-schemas Ajv bundles.
function vocabularyKeywords(): string[] {
  const require = createRequire(import.meta.url);
  const dir = join(
    dirname(require.resolve("ajv/package.json")),
    "dist/refs/json-schema-2020-12/meta",
  );
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => Object.keys(JSON.parse(readFileSync(join(dir, f), "utf8")).properties ?? {}));
}

test("the keyword table decides every keyword of the 2020-12 vocabularies", () => {
  expect(SCHEMA_KEYWORDS.map((k) => k.keyword).sort()).toEqual(vocabularyKeywords().sort());
});

test("every refused keyword has its reason and fix", () => {
  for (const k of REFUSED_SCHEMA_KEYWORDS) {
    expect(k.reason, k.keyword).not.toBe("");
    expect(k.fix, k.keyword).not.toBe("");
  }
});

test("the schema language shows each refused keyword with its reason", () => {
  const plain = (
    authoringSchemas().schema.$defs as Record<
      string,
      { properties: Record<string, { description?: string; not?: unknown }> }
    >
  ).plain;
  for (const k of REFUSED_SCHEMA_KEYWORDS) {
    const property = plain?.properties[k.keyword];
    expect(property?.not, k.keyword).toEqual({});
    expect(property?.description, k.keyword).toContain(k.reason);
  }
});
