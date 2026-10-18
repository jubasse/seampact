import type { IrWriter } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { type DraftIR, pipelineCopy } from "../pipeline/seam.js";
import {
  finalizeCompleteDraft,
  finalizeExpectIr,
  finalizeReferenceContext,
} from "./complete-draft.js";
import { finalizePrune } from "./prune.js";

const ISSUE_SCHEMA = "ApiSchemaInvalidIssue";
const SCHEMA_INVALID_CODE = "api.schema_invalid";

// The pruned copy of a draft, as finalize builds it; the draft itself is never changed.
function pruned(draft: DraftIR): DraftIR {
  const copy = pipelineCopy(draft);

  finalizePrune(copy);

  return copy;
}

function schemaOf(draft: DraftIR, id: string): IrWriter.ObjectSchema {
  const schema = draft.schemas[id];

  if (schema?.kind !== "object") throw new Error(`the draft has no object schema ${id}`);

  return schema;
}

function firstPropertyOf(schema: IrWriter.ObjectSchema): IrWriter.Property {
  const [property] = schema.properties;

  if (property === undefined) throw new Error(`the schema ${schema.id} has no property`);

  return property;
}

// A layer's `api.schema_invalid`, reached from the first operation, whose params replace the core ones and name the
// core issue schema, as ADR 0004 section 13 ("Core declarations") lets them.
function withReplacedSchemaInvalidParams(draft: DraftIR, paramsReferenceIssue: boolean): DraftIR {
  const template = schemaOf(draft, "ApiForbiddenParams");
  const property = firstPropertyOf(template);
  const issueType: IrWriter.TypeUse = { kind: "ref", schema: ISSUE_SCHEMA };

  draft.schemas[ISSUE_SCHEMA] = {
    ...template,
    id: ISSUE_SCHEMA,
    origin: { layer: "core", pointer: `/schemas/${ISSUE_SCHEMA}` },
  };
  draft.schemas.ApiSchemaInvalidParams = {
    ...template,
    id: "ApiSchemaInvalidParams",
    origin: { layer: "api", pointer: `/errors/${SCHEMA_INVALID_CODE}/params` },
    properties: [{ ...property, type: paramsReferenceIssue ? issueType : property.type }],
  };
  draft.errors[SCHEMA_INVALID_CODE] = {
    code: SCHEMA_INVALID_CODE,
    nature: "refused",
    http: { status: 400 },
    params: "ApiSchemaInvalidParams",
    docs: {},
    origin: { layer: "api", pointer: `/errors/${SCHEMA_INVALID_CODE}` },
  };
  draft.operations[0]?.errors?.push({ code: SCHEMA_INVALID_CODE });

  return draft;
}

describe("unreferenced core declarations are dropped", () => {
  test("an unreferenced default code and its params schema are dropped, a referenced one kept", () => {
    const draft = finalizeCompleteDraft("tasks");

    Reflect.set(draft.errors["api.forbidden"] ?? {}, "params", "ApiForbiddenParams");
    Reflect.set(
      draft.errors["api.sort_key_forbidden"] ?? {},
      "params",
      "ApiSortKeyForbiddenParams",
    );
    const ir = pruned(draft);

    expect(Object.keys(ir.errors)).toContain("api.forbidden");
    expect(Object.keys(ir.schemas)).toContain("ApiForbiddenParams");
    expect(Object.keys(ir.errors)).not.toContain("api.sort_key_forbidden");
    expect(Object.keys(ir.schemas)).not.toContain("ApiSortKeyForbiddenParams");
    expect(Object.keys(draft.errors)).toContain("api.sort_key_forbidden");
  });

  test("bare and ApiEmptyBody are dropped where no operation uses them", () => {
    const draft = finalizeCompleteDraft("tasks");

    expect(Object.keys(pruned(draft).formats)).toEqual(["bare"]);
    expect(Object.keys(pruned(draft).schemas)).toContain("ApiEmptyBody");

    draft.operations = [];
    const ir = pruned(draft);

    expect(ir.formats).toEqual({});
    expect(Object.keys(ir.schemas)).not.toContain("ApiEmptyBody");
  });

  test("a replaced api.schema_invalid params schema that names ApiSchemaInvalidIssue keeps it", () => {
    const referencing = pruned(
      withReplacedSchemaInvalidParams(finalizeCompleteDraft("tasks"), true),
    );
    const notReferencing = pruned(
      withReplacedSchemaInvalidParams(finalizeCompleteDraft("tasks"), false),
    );

    expect(Object.keys(referencing.schemas)).toEqual(
      expect.arrayContaining(["ApiSchemaInvalidParams", ISSUE_SCHEMA]),
    );
    expect(Object.keys(notReferencing.schemas)).toContain("ApiSchemaInvalidParams");
    expect(Object.keys(notReferencing.schemas)).not.toContain(ISSUE_SCHEMA);
  });

  test("a schema reached through its core origin keeps the code it belongs to", () => {
    const draft = finalizeCompleteDraft("tasks");
    const operation = draft.operations.find((candidate) => candidate.input !== undefined);

    if (operation?.input === undefined) throw new Error("the reference draft has no input");
    operation.input.schema = { kind: "ref", schema: "ApiPayloadTooLargeParams" };
    const ir = pruned(draft);

    expect(Object.keys(ir.schemas)).toContain("ApiPayloadTooLargeParams");
    expect(Object.keys(ir.errors)).toContain("api.payload_too_large");
  });
});

describe("unreachable declarations are dropped", () => {
  test("an authored right no operation or identity reaches is dropped, a reached one kept", () => {
    const ir = pruned(finalizeCompleteDraft("tasks"));

    expect(Object.keys(ir.rights)).toContain("tasks.read");
    expect(Object.keys(ir.rights)).not.toContain("callerService");
  });

  test("every identity stays, with what it reaches, when no operation uses it", () => {
    const draft = finalizeCompleteDraft("tasks");

    draft.operations = [];
    const ir = pruned(draft);

    expect(Object.keys(ir.identities)).toEqual(Object.keys(draft.identities));
    expect(Object.keys(ir.schemes)).toContain("internalToken");
    expect(Object.keys(ir.headers)).toEqual(Object.keys(draft.headers));
    expect(ir.rules).toEqual({});
  });

  test("an extension key stays where an extension value uses it", () => {
    const draft = finalizeCompleteDraft("tasks");
    const declaration = (key: string): IrWriter.ExtensionKeyDecl => ({
      id: `acme-${key}`,
      prefix: "acme",
      key,
      schema: firstPropertyOf(schemaOf(draft, "ApiForbiddenParams")).type,
      places: ["api"],
      origin: { layer: "api", pointer: `/extensions/acme/${key}` },
    });

    draft.extensionKeys["acme-owner"] = declaration("owner");
    draft.extensionKeys["acme-unused"] = declaration("unused");
    Reflect.set(draft.api ?? {}, "extensions", { acme: { owner: "tasks team" } });

    expect(Object.keys(pruned(draft).extensionKeys)).toEqual(["acme-owner"]);
  });

  test("the pruned reference apis validate", () => {
    for (const api of ["tasks", "tasksService"] as const) {
      const { ir } = finalizeExpectIr(finalizeCompleteDraft(api), finalizeReferenceContext(api));

      expect(Object.keys(ir.rights).length).toBeLessThan(
        Object.keys(finalizeCompleteDraft(api).rights).length,
      );
    }
  });
});
