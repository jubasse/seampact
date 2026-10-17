import { IR_REVISION, IR_VERSION } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import type { DraftIR } from "../pipeline/seam.js";
import { finalizeCompleteDraft, finalizeReferenceContext } from "./complete-draft.js";
import { finalizeIr } from "./finalize.js";
import {
  FINALIZE_FEATURE_TABLE,
  type FinalizeFeatureRow,
  finalizeMembers,
  finalizeOperationFeatures,
} from "./members.js";

const context = finalizeReferenceContext("tasks");

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;

  for (const key of Object.keys(value)) deepFreeze(Reflect.get(value, key));

  return Object.freeze(value);
}

// The first operation of the complete draft, which a test changes before finalizing.
function firstOperation(draft: DraftIR) {
  const [operation] = draft.operations;

  if (operation === undefined) throw new Error("the reference draft has no operation");

  return operation;
}

describe("finalize writes the version members", () => {
  test("the IR carries irVersion, irRevision, its kinds and no feature", () => {
    const { ir } = finalizeIr(finalizeCompleteDraft("tasks"), context);

    expect(FINALIZE_FEATURE_TABLE).toEqual([]);
    expect(ir).toMatchObject({
      irVersion: IR_VERSION,
      irRevision: IR_REVISION,
      kinds: ["httpOperation"],
      features: [],
    });
    expect(ir.operations.length).toBeGreaterThan(0);
    expect(ir.operations.every((operation) => operation.features.length === 0)).toBe(true);
  });

  test("a feature table row is listed, sorted and once, on each operation using it and in the union", () => {
    const table: readonly FinalizeFeatureRow[] = [
      { feature: "zeta", usedBy: (operation) => operation.id === "b" },
      { feature: "alpha", usedBy: () => true },
      { feature: "zeta", usedBy: (operation) => operation.id === "b" },
      { feature: "never", usedBy: () => false },
    ];
    const operations = [{ id: "a" }, { id: "b" }].map((operation) => ({
      ...operation,
      features: finalizeOperationFeatures(operation, table),
    }));

    expect(operations.map((operation) => operation.features)).toEqual([
      ["alpha"],
      ["alpha", "zeta"],
    ]);
    expect(finalizeMembers(operations)).toEqual({
      irVersion: IR_VERSION,
      irRevision: IR_REVISION,
      kinds: ["httpOperation"],
      features: ["alpha", "zeta"],
    });
  });

  test("an api with no operation has no declaration kind", () => {
    expect(finalizeMembers([]).kinds).toEqual([]);
  });
});

describe("finalize never changes the draft", () => {
  test("a deep-frozen draft finalizes and keeps its order", () => {
    const draft = finalizeCompleteDraft("tasks");

    draft.operations.reverse();
    const before = JSON.stringify(draft);

    deepFreeze(draft);
    const { ir } = finalizeIr(draft, context);

    expect(JSON.stringify(draft)).toBe(before);
    expect(ir.operations.map((operation) => operation.id)).not.toEqual(
      draft.operations.map((operation) => operation.id),
    );
  });

  test("two members that alias one object stay one unchanged object", () => {
    const draft = finalizeCompleteDraft("tasks");
    const [first, second] = draft.operations;
    const tags = ["z", "a"];

    if (first === undefined || second === undefined)
      throw new Error("the reference draft has two operations");
    first.tags = tags;
    second.tags = tags;
    const { ir } = finalizeIr(draft, context);

    expect(first.tags).toBe(second.tags);
    expect(tags).toEqual(["z", "a"]);
    expect(ir.operations.find((operation) => operation.id === first.id)?.tags).toEqual(["a", "z"]);
  });
});

describe("finalize validates the IR", () => {
  test.each([
    {
      name: "a member the strict schema refuses",
      change: (draft: DraftIR) => Reflect.set(firstOperation(draft), "method", 42),
      failure: "schema 'type' at '/operations/",
    },
    {
      name: "a member the IR does not know",
      change: (draft: DraftIR) => Reflect.set(firstOperation(draft), "unknownMember", true),
      failure: "schema 'unknown member' at '/operations/",
    },
    {
      name: "a value outside an open enum",
      change: (draft: DraftIR) =>
        Reflect.set(firstOperation(draft).maturity ?? {}, "level", "beta"),
      failure: "schema 'unknown value' at '/operations/",
    },
    {
      name: "a union tag the IR does not know",
      change: (draft: DraftIR) =>
        Reflect.set(Object.values(draft.schemas)[0] ?? {}, "kind", "tuple"),
      failure: "schema 'unknown kind' at '/schemas/",
    },
    {
      name: "a broken invariant",
      change: (draft: DraftIR) => firstOperation(draft).errors?.push({ code: "api.not_declared" }),
      failure: "invariant 'ir.ref.resolves' at '/operations/",
    },
  ])(
    "$name is an internal error naming the api, the rule and the pointer",
    ({ change, failure }) => {
      const draft = finalizeCompleteDraft("tasks");

      change(draft);

      expect(() => finalizeIr(draft, context)).toThrow(
        "finalize built an invalid IR for api 'tasks'",
      );
      expect(() => finalizeIr(draft, context)).toThrow(failure);
    },
  );
});

describe("a tolerated absence does not reach the IR", () => {
  test("an operation without access is refused", () => {
    const draft = finalizeCompleteDraft("tasks");

    delete firstOperation(draft).access;

    expect(() => finalizeIr(draft, context)).toThrow(
      /schema 'required' at '\/operations\/\d+': must have required property 'access'/,
    );
  });
});
