import { readdirSync, readFileSync } from "node:fs";
import { Ajv2020, type Options } from "ajv/dist/2020.js";
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
import { classifyIrErrors, createIrValidator } from "./validation.js";

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

const VALID_REPORT = {
  valid: true,
  unknownKinds: [],
  unknownValues: [],
  unknownMembers: [],
  problems: [],
};
const UNKNOWN_MEMBER = "zzUnknownMember";
const UNKNOWN_VALUE = "zzUnknownValue";

describe.each(VALID)("%s", (name) => {
  const value = sample(name);

  test("is valid in both forms", () => {
    expect(validateIr(value, "open")).toEqual(VALID_REPORT);
    expect(validateIr(value, "strict")).toEqual(VALID_REPORT);
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
        ...VALID_REPORT,
        valid: false,
        unknownMembers: [`${pointer}/${UNKNOWN_MEMBER}`],
      });
    }
  });

  test("unknown open-enum values accepted, unless must-act", () => {
    for (const node of nodesOf(value)) {
      if (node.kind !== "openEnum") continue;
      const mutated = replaceAt(value, node.pointer, UNKNOWN_VALUE);
      const named = [
        { pointer: node.pointer, value: UNKNOWN_VALUE, known: node.known, mustAct: node.mustAct },
      ];
      expect(validateIr(mutated, "open"), node.pointer).toEqual({
        ...VALID_REPORT,
        valid: !node.mustAct,
        unknownValues: named,
      });
      expect(validateIr(mutated, "strict"), node.pointer).toMatchObject({
        valid: false,
        unknownValues: named,
      });
    }
  });

  test("unknown kinds named, accepted open unless must-act, refused strict", () => {
    for (const node of nodesOf(value)) {
      if (node.kind !== "union") continue;
      const mutated = replaceAt(value, `${node.pointer}/${node.tag}`, UNKNOWN_VALUE);
      const named = [
        { pointer: node.pointer, tag: node.tag, value: UNKNOWN_VALUE, mustAct: node.mustAct },
      ];
      expect(validateIr(mutated, "open"), node.pointer).toEqual({
        ...VALID_REPORT,
        valid: !node.mustAct,
        unknownKinds: named,
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
  expect(validateIr(sample("unknown-enum-value.ir.json"), "open")).toMatchObject({
    valid: true,
    unknownValues: [
      { pointer: "/api/kind", value: "library", mustAct: false },
      { pointer: "/api/maturity", value: "deprecated", mustAct: false },
      { pointer: "/api/compat/policy", value: "semver", mustAct: false },
    ],
  });
  expect(validateIr(sample("unknown-kind.ir.json"), "open")).toEqual({
    ...VALID_REPORT,
    unknownKinds: [{ pointer: "/schemas/Point", tag: "kind", value: "tuple", mustAct: false }],
  });
  expect(validateIr(sample("unknown-kind.ir.json"), "strict").valid).toBe(false);
  // A must-act tag (a security scheme kind) makes the IR invalid for every reader.
  expect(validateIr(sample("unknown-must-act.ir.json"), "open")).toEqual({
    ...VALID_REPORT,
    valid: false,
    unknownKinds: [{ pointer: "/schemes/client", tag: "kind", value: "mtls", mustAct: true }],
  });
});

test("a mapping error the walk did not list fails closed", () => {
  // An unknown tag only the validator saw: whether its union is must-act is unknown, so it counts as must-act.
  const error = {
    instancePath: "/schemes/client",
    keyword: "discriminator",
    params: { error: "mapping", tag: "kind", tagValue: "mtls" },
  };
  expect(classifyIrErrors([error], "open")).toEqual({
    ...VALID_REPORT,
    valid: false,
    unknownKinds: [{ pointer: "/schemes/client", tag: "kind", value: "mtls", mustAct: true }],
  });
});

test("the validator's options are load-bearing: allErrors false hides a problem after an unknown kind", () => {
  // The unknown tag (/schemas/Point) is an expected discriminator error in the open form; the wrong member
  // type after it (/lint/allows) is a real problem, which only a validator collecting every error still sees.
  const ir = mutateAt(sample("unknown-kind.ir.json"), "/lint", (lint) => {
    lint.allows = "none";
  });
  const problem = [{ pointer: "/lint/allows", keyword: "type", message: "must be array" }];
  expect(validateIr(ir, "open")).toMatchObject({ valid: false, problems: problem });
  class FirstErrorOnly extends Ajv2020 {
    constructor(options: Options) {
      super({ ...options, allErrors: false });
    }
  }
  const firstErrorOnly = createIrValidator(FirstErrorOnly, "open").validate(ir);
  expect(firstErrorOnly).toMatchObject({ valid: true, problems: [] });
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
