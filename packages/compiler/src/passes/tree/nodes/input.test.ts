import type { IrWriter } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { diagnosticLocationKey } from "../../../diagnostics/print.js";
import { createDraftIR, type DraftIR, type TreeSchemaService } from "../../../pipeline/seam.js";
import { treeNodesFieldWire } from "./field-wire.js";
import {
  TREE_NODES_FIXTURES,
  treeNodesApiOf,
  treeNodesLoadDirectory,
  treeNodesLoadInline,
  treeNodesRun,
  treeNodesStubService,
} from "./test-support.js";

// Bodies beyond JSON (ADR 0002 section 7). The reference contract declares no form or multipart body, so these
// cases run on this lane's fixtures with the schemas and query wires tree.schemas would hand over.

const MiB = 1024 * 1024;

const text: IrWriter.TypeUse = { kind: "scalar", type: "string", refinements: {} };
const integer: IrWriter.TypeUse = { kind: "scalar", type: "integer", refinements: {} };
const textList: IrWriter.TypeUse = { kind: "array", items: text };
const jsonText: IrWriter.TypeUse = {
  kind: "scalar",
  type: "string",
  refinements: {},
  content: { media: "application/json", schema: { kind: "ref", schema: "SlackPayload" } },
};
const file = (maxSizeBytes?: number): IrWriter.TypeUse => ({
  kind: "file",
  media: ["image/png"],
  ...(maxSizeBytes === undefined ? {} : { maxSizeBytes }),
});
const opaque: IrWriter.TypeUse = {
  kind: "opaque",
  reason: "The caller sends any shape.",
  origin: { layer: "api", pointer: "/x" },
};

const wire = (kind: IrWriter.QueryWireKind, explode = true): IrWriter.QueryWire => ({
  kind,
  style: "form",
  explode,
  brackets: false,
});
const fieldWire = (kind: IrWriter.QueryWireKind, explode = true): IrWriter.FieldWire => ({
  ...wire(kind, explode),
});

// An object schema as tree.schemas writes it: one property per entry, located at `<pointer>/properties/<name>`.
function objectSchema(
  id: string,
  pointer: string,
  properties: Record<string, IrWriter.TypeUse>,
): IrWriter.ObjectSchema {
  return {
    kind: "object",
    id,
    name: { segments: [id.toLowerCase()], role: "schema" },
    directions: ["input"],
    examples: [],
    docs: {},
    extensions: {},
    origin: { layer: "api", pointer },
    properties: Object.entries(properties).map(([name, type]) => ({
      name,
      type,
      optional: false,
      nullable: false,
      sensitive: false,
      deprecated: false,
      docs: {},
      extensions: {},
      origin: { layer: "api", pointer: `${pointer}/properties/${name}` },
    })),
  };
}

function draftWith(...schemas: IrWriter.Schema[]): DraftIR {
  const draft = createDraftIR();
  for (const schema of schemas) draft.schemas[schema.id] = schema;
  return draft;
}

const route = (name: string): string => `/surfaces/app/routes/${name}`;
const SLACK = "/schemas/SlackCommand";
const ATTACH = `${route("attach")}/input`;
const BATCH = "reports/ops/batch";

test("bodies beyond JSON: form and multipart fields with their wires", () => {
  const workspace = treeNodesLoadDirectory(`${TREE_NODES_FIXTURES}bodies/`);
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${route("slackCommand")}/input`]: { kind: "ref", schema: "SlackCommand" },
      [ATTACH]: { kind: "ref", schema: "AttachInput" },
    },
    queryWires: {
      [`${SLACK}/properties/text`]: wire("text"),
      [`${SLACK}/properties/count`]: wire("number"),
      [`${SLACK}/properties/tags`]: wire("list"),
      [`${ATTACH}/properties/caption`]: wire("text"),
    },
  });
  const draft = draftWith(
    objectSchema("SlackCommand", SLACK, {
      text,
      count: integer,
      tags: textList,
      payload: jsonText,
    }),
    objectSchema("AttachInput", ATTACH, {
      file: file(20 * MiB),
      pages: { kind: "array", items: file() },
      caption: text,
    }),
  );

  const { diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
    draft,
  });

  expect(diagnostics).toEqual([]);
  expect(draft.operations.map(({ id, input }) => ({ id, input }))).toEqual([
    {
      id: "slackCommand",
      input: {
        media: "application/x-www-form-urlencoded",
        schema: { kind: "ref", schema: "SlackCommand" },
        origin: { layer: "api", pointer: `${route("slackCommand")}/input` },
        fields: [
          { name: "text", wire: fieldWire("text") },
          { name: "count", wire: fieldWire("number") },
          { name: "tags", wire: fieldWire("list") },
          { name: "payload", wire: { kind: "json" } },
        ],
      },
    },
    {
      id: "attach",
      input: {
        media: "multipart/form-data",
        schema: { kind: "ref", schema: "AttachInput" },
        origin: { layer: "api", pointer: ATTACH },
        fields: [
          { name: "file", wire: { kind: "file" } },
          { name: "pages", wire: { kind: "file" } },
          { name: "caption", wire: fieldWire("text") },
        ],
      },
    },
  ]);
});

test("bodies beyond JSON: files only in multipart within the body limit, form inputs are objects", () => {
  const workspace = treeNodesLoadDirectory(`${TREE_NODES_FIXTURES}bodies-refused/`);
  const raw = treeNodesApiOf(workspace);
  const input = (name: string): string => `${route(name)}/input`;
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [input("formFile")]: { kind: "ref", schema: "FormFileInput" },
      [input("tooLarge")]: { kind: "ref", schema: "TooLargeInput" },
      [input("jsonFile")]: { kind: "ref", schema: "JsonFileInput" },
      [input("formScalar")]: text,
      [input("formOpaque")]: { kind: "ref", schema: "FormOpaqueInput" },
      [input("formJsonText")]: { kind: "ref", schema: "FormJsonTextInput" },
      [input("multipartObject")]: { kind: "ref", schema: "MultipartObjectInput" },
      [input("multipartPages")]: { kind: "ref", schema: "MultipartPagesInput" },
      [input(BATCH)]: { kind: "ref", schema: "ReportsBatchInput" },
    },
  });
  const draft = draftWith(
    objectSchema("FormFileInput", input("formFile"), { file: file() }),
    objectSchema("TooLargeInput", input("tooLarge"), { file: file(2 * MiB) }),
    objectSchema("JsonFileInput", input("jsonFile"), { file: file() }),
    objectSchema("FormOpaqueInput", input("formOpaque"), { anything: opaque }),
    objectSchema("FormJsonTextInput", input("formJsonText"), {
      meta: {
        kind: "scalar",
        type: "string",
        refinements: {},
        content: { media: "application/json", schema: { kind: "ref", schema: "WithFile" } },
      },
    }),
    objectSchema("WithFile", "/schemas/WithFile", { file: file() }),
    objectSchema("MultipartObjectInput", input("multipartObject"), {
      doc: { kind: "ref", schema: "MultipartObjectDoc" },
    }),
    objectSchema("MultipartObjectDoc", `${input("multipartObject")}/properties/doc`, {
      scan: file(),
    }),
    objectSchema("MultipartPagesInput", input("multipartPages"), {
      pages: { kind: "array", items: { kind: "array", items: file() } },
    }),
    objectSchema("ReportsBatchInput", input(BATCH), { file: file(3 * MiB) }),
  );

  const { diagnostics } = treeNodesRun(raw, workspace, { treeSchemas, draft });

  expect(diagnostics.map(({ rule, origin, related }) => ({ rule, origin, related }))).toEqual([
    {
      rule: "seampact/tree/input-file",
      origin: { layer: "api", pointer: `${input("formFile")}/properties/file` },
      related: [],
    },
    {
      rule: "seampact/tree/input-file-size",
      origin: { layer: "api", pointer: `${input("tooLarge")}/properties/file` },
      related: [
        { origin: { layer: "api", pointer: "/conventions/bodyLimit" }, message: "the body limit" },
      ],
    },
    {
      rule: "seampact/tree/input-file",
      origin: { layer: "api", pointer: `${input("jsonFile")}/properties/file` },
      related: [],
    },
    {
      rule: "seampact/tree/form-input",
      origin: { layer: "api", pointer: input("formScalar") },
      related: [],
    },
    {
      rule: "seampact/tree/form-field",
      origin: { layer: "api", pointer: `${input("formOpaque")}/properties/anything` },
      related: [],
    },
    {
      rule: "seampact/tree/input-file",
      origin: { layer: "api", pointer: "/schemas/WithFile/properties/file" },
      related: [],
    },
    {
      rule: "seampact/tree/input-file",
      origin: { layer: "api", pointer: `${input("multipartObject")}/properties/doc/properties/scan` },
      related: [],
    },
    {
      rule: "seampact/tree/input-file",
      origin: { layer: "api", pointer: `${input("multipartPages")}/properties/pages` },
      related: [],
    },
    {
      rule: "seampact/tree/input-file-size",
      origin: { layer: "api", pointer: `${input(BATCH)}/properties/file` },
      related: [
        {
          origin: { layer: "api", pointer: "/conventions/batch/bodyLimit" },
          message: "the body limit",
        },
      ],
    },
  ]);
  expect(diagnostics[1]?.message).toBe(
    "The file field file of tooLarge allows 2097152 bytes, more than the route's body limit of 1048576 bytes.",
  );
  expect(diagnostics.slice(5, 8).map(({ message }) => message)).toEqual([
    "The form input of formJsonText holds a file at file inside the field meta, but a file is a top-level field.",
    "The multipart input of multipartObject holds a file at scan inside the field doc, but a file is a top-level field.",
    "The multipart input of multipartPages holds a file inside the field pages, but a file is a top-level field.",
  ]);
  expect(diagnostics[8]?.message).toBe(
    "The file field file of getReportsBatch allows 3145728 bytes, more than the route's body limit of 2097152 bytes.",
  );

  for (const diagnostic of diagnostics) {
    expect(diagnostic.message.endsWith(".")).toBe(true);
    for (const origin of [diagnostic.origin, ...diagnostic.related.map((r) => r.origin)])
      expect(Object.hasOwn(raw.locations, diagnosticLocationKey(origin))).toBe(true);
  }
});

const FIELD = "/schemas/Form/properties/field";

test.each<{ use: IrWriter.TypeUse; answer?: IrWriter.QueryWire; expected: IrWriter.FieldWire }>([
  { use: integer, answer: wire("number"), expected: fieldWire("number") },
  {
    use: { kind: "scalar", type: "boolean", refinements: {} },
    answer: wire("boolean"),
    expected: fieldWire("boolean"),
  },
  { use: textList, answer: wire("list", false), expected: fieldWire("list", false) },
  { use: text, answer: wire("text"), expected: fieldWire("text") },
  {
    use: { kind: "ref", schema: "Filter" },
    answer: { kind: "object", style: "deepObject", explode: true, brackets: false },
    expected: { kind: "object", style: "deepObject", explode: true, brackets: false },
  },
  { use: file(), expected: { kind: "file" } },
  { use: { kind: "array", items: file() }, expected: { kind: "file" } },
  { use: jsonText, expected: { kind: "json" } },
])("field wire shared: $expected.kind", ({ use, answer, expected }) => {
  const asked: string[] = [];
  const treeSchemas: TreeSchemaService = {
    ...treeNodesStubService({}),
    queryWire: (pointer) => {
      asked.push(pointer);
      return answer;
    },
  };

  expect(treeNodesFieldWire(FIELD, use, treeSchemas)).toEqual(expected);
  expect(asked).toEqual(answer === undefined ? [] : [FIELD]);
});

test("field wire shared: a field the service has no wire for throws", () => {
  expect(() => treeNodesFieldWire(FIELD, text, treeNodesStubService({}))).toThrow(
    /no query wire for the field at \/schemas\/Form\/properties\/field/,
  );
});

// A body-versioned update (ADR 0002 section 11): tree.schemas adds `expectedVersion` to the input, with the
// concurrency setting as its origin. Its wire is still asked at its position in the input schema.
const FORM_UPDATE = `
api: { name: tasks, version: 1, kind: product }
schemas:
  TaskId: { type: string }
  Task:
    type: object
    required: [taskId, title, version]
    properties:
      taskId: TaskId
      title: { type: string }
      version: { type: integer }
  UpdateTask:
    type: object
    properties:
      title: { type: string }
surfaces:
  app:
    prefix: /v{version}
    routes:
      tasks:
        kind: collection
        id: { taskId: TaskId }
        item: Task
        concurrency: { version: body.expectedVersion, field: version }
        ops:
          update: { input: UpdateTask, inputMedia: form }
`;

test("bodies beyond JSON: a derived form field's wire is asked at its position in the input schema", () => {
  const workspace = treeNodesLoadInline(FORM_UPDATE);
  const updateTask = "/schemas/UpdateTask";
  const treeSchemas = treeNodesStubService({
    typeUses: {
      "/surfaces/app/routes/tasks/ops/update/input": { kind: "ref", schema: "UpdateTask" },
    },
    queryWires: {
      [`${updateTask}/properties/title`]: wire("text"),
      [`${updateTask}/properties/expectedVersion`]: wire("number"),
    },
  });
  const schema = objectSchema("UpdateTask", updateTask, { title: text, expectedVersion: integer });
  const expectedVersion = schema.properties[1];
  if (expectedVersion === undefined) throw new Error("the schema has no expectedVersion");
  expectedVersion.origin = {
    layer: "api",
    pointer: "/surfaces/app/routes/tasks/concurrency/version",
  };

  const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
    draft: draftWith(schema),
  });

  expect(diagnostics).toEqual([]);
  expect(draft.operations[0]?.input?.fields).toEqual([
    { name: "title", wire: fieldWire("text") },
    { name: "expectedVersion", wire: fieldWire("number") },
  ]);
});
