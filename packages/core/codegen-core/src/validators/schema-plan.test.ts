import { type ContractIR, isKnownVariant, type Property } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { readGoldenIr } from "../node-server/reference-project.test-support.js";
import { planValidatorsLayout } from "./layout.js";
import { planSchemaModule } from "./schema-plan.js";
import type { TypePlan } from "./type-plan.js";

const SCHEMA_ID = "Preferences";

function planOf(property: Pick<Property, "nullable" | "type">): TypePlan | undefined {
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

  const refusals: never[] = [];
  const [plan] = planSchemaModule("input", ir, layout.layout, refusals);

  expect(refusals).toEqual([]);

  return plan?.object.fields[0]?.type;
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
