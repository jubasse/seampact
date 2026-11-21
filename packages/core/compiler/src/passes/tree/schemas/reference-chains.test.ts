import { describe, expect, test } from "vitest";
import { treeSchemasRunApi } from "./test-support.js";

// Chains longer than the call stack: each is walked with a list, not by recursion.

const OBJECT_LINKS = 3_000;
const ALIAS_LINKS = 9_000;

const indices = (count: number): number[] => Array.from({ length: count }, (_, index) => index);

function objectChain(): string {
  const links = indices(OBJECT_LINKS).map((index) =>
    index === OBJECT_LINKS - 1
      ? `  Node${index}: { type: object, properties: { last: { type: string } } }`
      : `  Node${index}: { type: object, properties: { next: Node${index + 1} } }`,
  );

  return `schemas:\n${links.join("\n")}
surfaces:
  app:
    routes:
      send: { method: post, input: Node0, output: Node0 }
`;
}

function aliasChain(): string {
  const links = indices(ALIAS_LINKS).map(
    (index) => `  Alias${index}: ${index === ALIAS_LINKS - 1 ? "Target" : `Alias${index + 1}`}`,
  );

  return `schemas:
  Target: { type: object, properties: { last: { type: string } } }
${links.join("\n")}
surfaces:
  app:
    routes:
      send: { method: post, input: Alias0, output: Alias0 }
`;
}

describe("long reference chains", () => {
  test("a chain of object properties gives its directions to every link", () => {
    const run = treeSchemasRunApi(objectChain());

    expect(run.diagnostics).toEqual([]);
    expect(run.draft.schemas[`Node${OBJECT_LINKS - 1}`]?.directions).toEqual(["input", "output"]);
  });

  test("a chain of aliases reaches its target", () => {
    const run = treeSchemasRunApi(aliasChain());

    expect(run.diagnostics).toEqual([]);
    expect(run.draft.schemas.Target?.directions).toEqual(["input", "output"]);
  });
});
