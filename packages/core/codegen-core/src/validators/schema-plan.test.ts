import { type ContractIR, isKnownVariant, type Property } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { readGoldenIr } from "../node-server/reference-project.test-support.js";
import type { Refusal } from "../refusal.js";
import { planValidatorsLayout } from "./layout.js";
import { planSchemaModule } from "./schema-plan.js";
import type { TypePlan } from "./type-plan.js";

const SCHEMA_ID = "Preferences";

function planOf(property: Pick<Property, "nullable" | "type">): TypePlan | undefined {
  const { type, refusals } = planWithRefusals(property);

  expect(refusals).toEqual([]);

  return type;
}

function planWithRefusals(property: Pick<Property, "nullable" | "type">): {
  type: TypePlan | undefined;
  refusals: Refusal[];
} {
  const golden = readGoldenIr("tasks");
  const schema = golden.schemas[SCHEMA_ID];

  if (schema === undefined || !isKnownVariant("Schema", schema) || schema.kind !== "object")
    throw new Error("the golden Preferences schema is an object");

  const [template] = schema.properties;

  if (template === undefined) throw new Error("the golden Preferences schema has a property");

  const ir: ContractIR = {
    ...golden,
    operations: [],
    schemas: {
      [SCHEMA_ID]: {
        ...schema,
        directions: ["input"],
        properties: [{ ...template, name: "value", optional: false, ...property }],
      },
    },
  };
  const layout = planValidatorsLayout(ir);

  if (layout.status !== "planned") throw new Error("the layout of the test schema is planned");

  const refusals: Refusal[] = [];
  const [plan] = planSchemaModule("input", ir, layout.layout, refusals);

  return { type: plan?.object.fields[0]?.type, refusals };
}

function steppedScalar(
  type: "integer" | "number",
  multipleOf: string,
): Pick<Property, "nullable" | "type"> {
  return { nullable: false, type: { kind: "scalar", type, refinements: { multipleOf } } };
}

describe("the plan of an opaque value", () => {
  test("a nullable opaque property plans a nullable unknown", () => {
    expect(planOf({ nullable: true, type: { kind: "opaque" } })).toEqual({
      kind: "unknown",
      nullable: true,
    });
  });

  test("a nullable opaque array item plans a nullable unknown", () => {
    const plan = planOf({
      nullable: false,
      type: { kind: "array", items: { kind: "opaque", nullable: true } },
    });

    expect(plan).toMatchObject({ kind: "array", items: { kind: "unknown", nullable: true } });
  });

  test("a plain opaque property plans a non-nullable unknown", () => {
    expect(planOf({ nullable: false, type: { kind: "opaque" } })).toEqual({
      kind: "unknown",
      nullable: false,
    });
  });
});

describe("the plan of a multipleOf step", () => {
  test.each([
    ["0.07", "7"],
    ["0.00001", "1"],
    ["2.5", "5"],
    ["5", "5"],
  ])("an integer step %s checks the exact integer step %s", (literal, integerStep) => {
    expect(planOf(steppedScalar("integer", literal))).toEqual({
      kind: "scalar",
      base: "integer",
      checks: [
        { rule: "multipleOf", literal, integerStep, message: `Expected a multiple of ${literal}.` },
      ],
    });
  });

  test("a step on a number is refused by name, as the compiler refuses it", () => {
    const { refusals } = planWithRefusals(steppedScalar("number", "0.5"));

    expect(refusals.map((refusal) => refusal.code)).toEqual(["scalar.multipleOf.misplaced"]);
  });

  test("a zero step is refused by name", () => {
    const { refusals } = planWithRefusals(steppedScalar("integer", "0"));

    expect(refusals.map((refusal) => refusal.code)).toEqual(["scalar.multipleOf.zero"]);
  });
});
