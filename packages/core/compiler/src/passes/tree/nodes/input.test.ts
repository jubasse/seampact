import type { IrWriter } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import type { Diagnostic } from "../../../diagnostics/diagnostic.js";
import { diagnosticLocationKey } from "../../../diagnostics/print.js";
import type { TreeSchemaService } from "../../../pipeline/seam.js";
import type { RawApi } from "../../../raw-tree.js";
import { treeNodesFieldWire } from "./field-wire.js";
import {
  TREE_NODES_CURSOR_PAGING,
  TREE_NODES_FIXTURES,
  treeNodesApiOf,
  treeNodesDraftWith,
  treeNodesLoadDirectory,
  treeNodesLoadInline,
  treeNodesObjectSchema,
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
  const draft = treeNodesDraftWith(
    treeNodesObjectSchema("SlackCommand", SLACK, {
      text,
      count: integer,
      tags: textList,
      payload: jsonText,
    }),
    treeNodesObjectSchema("AttachInput", ATTACH, {
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

const refusedInput = (name: string): string => `${route(name)}/input`;

// The bodies-refused fixture, run with the input uses and schemas tree.schemas would hand over.
function runBodiesRefused(): { raw: RawApi; diagnostics: Diagnostic[] } {
  const workspace = treeNodesLoadDirectory(`${TREE_NODES_FIXTURES}bodies-refused/`);
  const raw = treeNodesApiOf(workspace);
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [refusedInput("formFile")]: { kind: "ref", schema: "FormFileInput" },
      [refusedInput("tooLarge")]: { kind: "ref", schema: "TooLargeInput" },
      [refusedInput("jsonFile")]: { kind: "ref", schema: "JsonFileInput" },
      [refusedInput("formScalar")]: text,
      [refusedInput("formOpaque")]: { kind: "ref", schema: "FormOpaqueInput" },
      [refusedInput("formJsonText")]: { kind: "ref", schema: "FormJsonTextInput" },
      [refusedInput("multipartObject")]: { kind: "ref", schema: "MultipartObjectInput" },
      [refusedInput("multipartPages")]: { kind: "ref", schema: "MultipartPagesInput" },
      [refusedInput(BATCH)]: { kind: "ref", schema: "ReportsBatchInput" },
    },
  });
  const draft = treeNodesDraftWith(
    treeNodesObjectSchema("FormFileInput", refusedInput("formFile"), { file: file() }),
    treeNodesObjectSchema("TooLargeInput", refusedInput("tooLarge"), { file: file(2 * MiB) }),
    treeNodesObjectSchema("JsonFileInput", refusedInput("jsonFile"), { file: file() }),
    treeNodesObjectSchema("FormOpaqueInput", refusedInput("formOpaque"), { anything: opaque }),
    treeNodesObjectSchema("FormJsonTextInput", refusedInput("formJsonText"), {
      meta: {
        kind: "scalar",
        type: "string",
        refinements: {},
        content: { media: "application/json", schema: { kind: "ref", schema: "WithFile" } },
      },
    }),
    treeNodesObjectSchema("WithFile", "/schemas/WithFile", { file: file() }),
    treeNodesObjectSchema("MultipartObjectInput", refusedInput("multipartObject"), {
      doc: { kind: "ref", schema: "MultipartObjectDoc" },
    }),
    treeNodesObjectSchema(
      "MultipartObjectDoc",
      `${refusedInput("multipartObject")}/properties/doc`,
      {
        scan: file(),
      },
    ),
    treeNodesObjectSchema("MultipartPagesInput", refusedInput("multipartPages"), {
      pages: { kind: "array", items: { kind: "array", items: file() } },
    }),
    treeNodesObjectSchema("ReportsBatchInput", refusedInput(BATCH), { file: file(3 * MiB) }),
  );

  return { raw, diagnostics: treeNodesRun(raw, workspace, { treeSchemas, draft }).diagnostics };
}

test("bodies beyond JSON: files only in multipart within the body limit, form inputs are objects", () => {
  const { diagnostics } = runBodiesRefused();

  expect(diagnostics.map(({ rule, origin, related }) => ({ rule, origin, related }))).toEqual([
    {
      rule: "seampact/tree/input-file",
      origin: { layer: "api", pointer: `${refusedInput("formFile")}/properties/file` },
      related: [],
    },
    {
      rule: "seampact/tree/input-file-size",
      origin: { layer: "api", pointer: `${refusedInput("tooLarge")}/properties/file` },
      related: [
        { origin: { layer: "api", pointer: "/conventions/bodyLimit" }, message: "the body limit" },
      ],
    },
    {
      rule: "seampact/tree/input-file",
      origin: { layer: "api", pointer: `${refusedInput("jsonFile")}/properties/file` },
      related: [],
    },
    {
      rule: "seampact/tree/form-input",
      origin: { layer: "api", pointer: refusedInput("formScalar") },
      related: [],
    },
    {
      rule: "seampact/tree/form-field",
      origin: { layer: "api", pointer: `${refusedInput("formOpaque")}/properties/anything` },
      related: [],
    },
    {
      rule: "seampact/tree/input-file",
      origin: { layer: "api", pointer: "/schemas/WithFile/properties/file" },
      related: [],
    },
    {
      rule: "seampact/tree/input-file",
      origin: {
        layer: "api",
        pointer: `${refusedInput("multipartObject")}/properties/doc/properties/scan`,
      },
      related: [],
    },
    {
      rule: "seampact/tree/input-file",
      origin: { layer: "api", pointer: `${refusedInput("multipartPages")}/properties/pages` },
      related: [],
    },
    {
      rule: "seampact/tree/input-file-size",
      origin: { layer: "api", pointer: `${refusedInput(BATCH)}/properties/file` },
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
  expect(() =>
    treeNodesFieldWire(FIELD, text, treeNodesStubService({ typeUses: { [FIELD]: text } })),
  ).toThrow(/no query wire for the field at \/schemas\/Form\/properties\/field/);
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
  const schema = treeNodesObjectSchema("UpdateTask", updateTask, {
    title: text,
    expectedVersion: integer,
  });
  const expectedVersion = schema.properties[1];

  if (expectedVersion === undefined) throw new Error("the schema has no expectedVersion");
  expectedVersion.origin = {
    layer: "api",
    pointer: "/surfaces/app/routes/tasks/concurrency/version",
  };
  expectedVersion.derivedFrom = {
    derivation: "concurrency.version",
    from: [expectedVersion.origin],
  };

  const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
    draft: treeNodesDraftWith(schema),
  });

  expect(diagnostics).toEqual([]);
  expect(draft.operations[0]?.input?.fields).toEqual([
    { name: "title", wire: fieldWire("text") },
    { name: "expectedVersion", wire: fieldWire("number") },
  ]);
});

test("bodies beyond JSON: a form input written { $ref: X } has its wires asked in the schema X", () => {
  const workspace = treeNodesLoadInline(
    FORM_UPDATE.replace("update: { input: UpdateTask,", "update: { input: { $ref: UpdateTask },"),
  );
  const updateTask = "/schemas/UpdateTask";
  const treeSchemas = treeNodesStubService({
    typeUses: {
      "/surfaces/app/routes/tasks/ops/update/input": { kind: "ref", schema: "UpdateTask" },
    },
    queryWires: { [`${updateTask}/properties/title`]: wire("text") },
  });
  const schema = treeNodesObjectSchema("UpdateTask", updateTask, { title: text });
  const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
    draft: treeNodesDraftWith(schema),
  });

  expect(diagnostics).toEqual([]);
  expect(draft.operations[0]?.input?.fields).toEqual([{ name: "title", wire: fieldWire("text") }]);
});

test("bodies beyond JSON: a body limit beyond a safe integer is reported where written", () => {
  const workspace = treeNodesLoadInline(`
api: { name: uploads, version: 1, kind: product }
conventions:
  batch: { bodyLimit: 99999999999999999999MiB }
surfaces:
  app:
    prefix: /v{version}
    routes:
      attach:
        method: post
        inputMedia: multipart
        bodyLimit: 99999999999999999999MiB
        input:
          type: object
          properties:
            file: { file: { media: [image/png], maxSize: 2MiB } }
`);
  const treeSchemas = treeNodesStubService({
    typeUses: { [ATTACH]: { kind: "ref", schema: "AttachInput" } },
  });
  const draft = treeNodesDraftWith(
    treeNodesObjectSchema("AttachInput", ATTACH, { file: file(2 * MiB) }),
  );

  const { diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
    draft,
  });

  expect(diagnostics.map(({ rule, origin }) => ({ rule, origin }))).toEqual([
    {
      rule: "seampact/tree/body-limit",
      origin: { layer: "api", pointer: "/surfaces/app/routes/attach/bodyLimit" },
    },
    {
      rule: "seampact/tree/body-limit",
      origin: { layer: "api", pointer: "/conventions/batch/bodyLimit" },
    },
  ]);
});

// The rules of bodies and operation names, each diagnostic located in the locations table, with a sentence and a fix.
const NAMING_REFUSED = `
api: { name: a, version: 1, kind: product }
${TREE_NODES_CURSOR_PAGING}
schemas:
  TaskId: { type: string }
surfaces:
  app:
    prefix: /v{version}
    routes:
      tasks: { kind: collection, id: { taskId: TaskId }, item: TaskId, ops: [list] }
      listTasks: { method: get }
      archive: { method: post, operationId: list_tasks }
      logs: { kind: collection, ops: { create: { input: TaskId } } }
`;

test("tree.nodes diagnostics are located: bodies and operation names", () => {
  const naming = treeNodesLoadInline(NAMING_REFUSED);
  const namingRaw = treeNodesApiOf(naming);
  const runs = [
    runBodiesRefused(),
    {
      raw: namingRaw,
      diagnostics: treeNodesRun(namingRaw, naming, { treeSchemas: treeNodesStubService({}) })
        .diagnostics,
    },
  ];

  const rules = new Set(runs.flatMap(({ diagnostics }) => diagnostics.map(({ rule }) => rule)));

  expect([...rules].sort()).toEqual(
    [
      "collection-singular",
      "form-field",
      "form-input",
      "input-file",
      "input-file-size",
      "operation-id-unique",
      "operation-name-unique",
    ].map((rule) => `seampact/tree/${rule}`),
  );

  for (const { raw, diagnostics } of runs)
    for (const diagnostic of diagnostics) {
      expect(diagnostic.message.endsWith(".")).toBe(true);
      expect(diagnostic.fix).not.toBe("");

      for (const origin of [diagnostic.origin, ...diagnostic.related.map((r) => r.origin)])
        expect(Object.hasOwn(raw.locations, diagnosticLocationKey(origin))).toBe(true);
    }
});
