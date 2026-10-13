import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { derivationCoreSchemaIds } from "./roles.js";

const ADR = readFileSync(
  fileURLToPath(new URL("../../../../docs/adr/0004-ir-shape.md", import.meta.url)),
  "utf8",
);

// The reserved ids ADR 0004 section 13 lists, in its order: the backticked schema ids of the sentence that
// reserves them, up to the yield rule.
function adrReservedIds(): string[] {
  const start = ADR.indexOf("The core schema ids are reserved:");
  const end = ADR.indexOf("A reserved params id belongs", start);
  if (start < 0 || end < 0)
    throw new Error("ADR 0004 section 13 lists no reserved core schema ids");
  return [...ADR.slice(start, end).matchAll(/`(Api[A-Za-z]+)`/g)].map((m) => m[1] ?? "");
}

test("the reserved core schema ids match ADR 0004 section 13", () => {
  expect([...derivationCoreSchemaIds]).toEqual(adrReservedIds());
  expect(derivationCoreSchemaIds).toEqual([
    "ApiSchemaInvalidParams",
    "ApiForbiddenParams",
    "ApiSortKeyForbiddenParams",
    "ApiPayloadTooLargeParams",
    "ApiRateLimitedParams",
    "ApiSchemaInvalidIssue",
    "ApiEmptyBody",
  ]);
});
