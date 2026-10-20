import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { emitDocuments } from "./documents.js";
import { at, readGoldenIr } from "./golden-documents.test-support.js";

// A text template made of constant slots (ADR 0002 section 13): `/contexts/${resource}` names one context.

const ITEM_SCHEMA = "Task";
const TYPE_NAME = "TaskRecord";

function contextOfGetTask(typeName: string | undefined): unknown {
  const ir = readGoldenIr("pack-api-platform/tasks");
  const named = ir.schemas[ITEM_SCHEMA];

  if (named === undefined || named.kind !== "object") throw new Error("the golden has no Task");

  if (typeName === undefined) delete named.typeName;
  else named.typeName = typeName;

  const getTask = ir.operations.find((operation) => operation.id === "getTask");

  if (getTask === undefined) throw new Error("the golden has no getTask");

  const outcome = emitDocuments(ir);
  const document = outcome.status === "emitted" ? parse(outcome.documents[0]?.text ?? "") : {};
  const media = getTask.responses[0]?.media ?? "";

  expect(outcome.status).toBe("emitted");

  return at(
    document,
    "paths",
    getTask.path,
    "get",
    "responses",
    "200",
    "content",
    media,
    "schema",
    "allOf",
    0,
    "properties",
    "@context",
  );
}

describe("a text template of constant slots", () => {
  it("is the constant text, built from the item schema's name", () => {
    expect(contextOfGetTask(undefined)).toEqual({ const: `/contexts/${ITEM_SCHEMA}` });
  });

  it("reads `$resource` from the item schema's typeName when it has one", () => {
    expect(contextOfGetTask(TYPE_NAME)).toEqual({ const: `/contexts/${TYPE_NAME}` });
  });
});
