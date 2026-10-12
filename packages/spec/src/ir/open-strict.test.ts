import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import minimal from "../../schemas/ir/examples/minimal.ir.json" with { type: "json" };
import { isSchemaNode } from "./schema-walk.js";
import { IR_SCHEMA_DOCUMENTS } from "./schemas.js";
import {
  definitionNames,
  type InstanceNode,
  mutateAt,
  replaceAt,
  validateIr,
  walkInstance,
} from "./test-support.js";
import type { ContractIR } from "./types.generated.js";

const EXAMPLES = new URL("../../schemas/ir/examples/", import.meta.url);
const sample = (name: string): unknown => JSON.parse(readFileSync(new URL(name, EXAMPLES), "utf8"));
// The valid samples the property tests mutate; the `unknown-*` samples are the fixed cases.
const VALID = readdirSync(EXAMPLES).filter(
  (name) => name.endsWith(".ir.json") && !name.startsWith("unknown-"),
);

const nodesOf = (value: unknown): InstanceNode[] => {
  const nodes: InstanceNode[] = [];
  walkInstance(value, (node) => nodes.push(node));
  return nodes;
};

const UNKNOWN_MEMBER = "zzUnknownMember";
const UNKNOWN_VALUE = "zzUnknownValue";

describe.each(VALID)("%s", (name) => {
  const value = sample(name);

  test("is valid in both forms", () => {
    expect(validateIr(value, "open")).toEqual({
      valid: true,
      unknownKinds: [],
      unknownMembers: [],
      problems: [],
    });
    expect(validateIr(value, "strict")).toEqual({
      valid: true,
      unknownKinds: [],
      unknownMembers: [],
      problems: [],
    });
  });

  test("unknown members accepted", () => {
    const objects = nodesOf(value).filter((node) => node.kind === "object");
    expect(objects.length).toBeGreaterThan(0);
    for (const { pointer } of objects) {
      const mutated = mutateAt(value, pointer, (node) => {
        node[UNKNOWN_MEMBER] = { nested: [1, "two", null] };
      });
      expect(validateIr(mutated, "open"), pointer).toMatchObject({ valid: true, unknownKinds: [] });
    }
  });

  test("strict form refuses unknown members", () => {
    for (const { pointer } of nodesOf(value).filter((node) => node.kind === "object")) {
      const mutated = mutateAt(value, pointer, (node) => {
        node[UNKNOWN_MEMBER] = true;
      });
      expect(validateIr(mutated, "strict"), pointer).toEqual({
        valid: false,
        unknownKinds: [],
        unknownMembers: [`${pointer}/${UNKNOWN_MEMBER}`],
        problems: [],
      });
    }
  });

  test("unknown open-enum values accepted", () => {
    for (const { pointer } of nodesOf(value).filter((node) => node.kind === "openEnum")) {
      const mutated = replaceAt(value, pointer, UNKNOWN_VALUE);
      expect(validateIr(mutated, "open"), pointer).toMatchObject({ valid: true, unknownKinds: [] });
    }
  });

  test("unknown kinds named, accepted open and refused strict", () => {
    for (const node of nodesOf(value)) {
      if (node.kind !== "union") continue;
      const mutated = replaceAt(value, `${node.pointer}/${node.tag}`, UNKNOWN_VALUE);
      const named = [{ pointer: node.pointer, tag: node.tag, value: UNKNOWN_VALUE }];
      expect(validateIr(mutated, "open"), node.pointer).toEqual({
        valid: true,
        unknownKinds: named,
        unknownMembers: [],
        problems: [],
      });
      expect(validateIr(mutated, "strict"), node.pointer).toMatchObject({
        valid: false,
        unknownKinds: named,
      });
    }
  });
});

test("the samples reach every definition of the schema", () => {
  // Every object definition, union and open enum is exercised by the property tests above.
  const reached = new Set<string>();
  for (const name of VALID) {
    for (const node of nodesOf(sample(name))) {
      if (node.kind !== "openEnum" && node.definition !== undefined) reached.add(node.definition);
    }
  }
  const shapes = new Set<string>();
  for (const document of IR_SCHEMA_DOCUMENTS) {
    for (const [name, def] of Object.entries(
      document.$defs as Record<string, Record<string, unknown>>,
    )) {
      if (isSchemaNode(def.properties) || isSchemaNode(def.discriminator)) shapes.add(name);
    }
  }
  // The side table has its own sample and test.
  const missing = [...shapes].filter((name) => !reached.has(name) && !name.startsWith("Source"));
  expect(missing).toEqual([]);
  expect(definitionNames().length).toBeGreaterThan(shapes.size);
});

test("fixed unknown cases", () => {
  expect(validateIr(sample("unknown-member.ir.json"), "open").valid).toBe(true);
  expect(validateIr(sample("unknown-member.ir.json"), "strict").unknownMembers).toEqual([
    "/generatedBy",
    "/api/owner",
    "/api/origin/column",
  ]);
  expect(validateIr(sample("unknown-enum-value.ir.json"), "open").valid).toBe(true);
  expect(validateIr(sample("unknown-kind.ir.json"), "open")).toEqual({
    valid: true,
    unknownKinds: [{ pointer: "/schemas/Point", tag: "kind", value: "tuple" }],
    unknownMembers: [],
    problems: [],
  });
  expect(validateIr(sample("unknown-kind.ir.json"), "strict").valid).toBe(false);
});

// JSON module imports widen every literal string to `string` (TypeScript has no const JSON import), so the sample
// is assigned to ContractIR with its literal string types widened the same way: every member, its optionality
// and its JSON type are still checked by the compiler; the literal values are checked by the schema above.
type Widened<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? Widened<U>[]
    : T extends object
      ? { [K in keyof T]: Widened<T[K]> }
      : T;

test("minimal sample", () => {
  const ir: Widened<ContractIR> = minimal;
  expect(validateIr(ir, "open").valid).toBe(true);
  expect(validateIr(ir, "strict").valid).toBe(true);
});
