import { type ContractIR, IR_REVISION, type IrWriter } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import type { DraftIR } from "../../../pipeline/seam.js";
import { type TreeSchemasRun, treeSchemasRunApi } from "./test-support.js";

const located = (run: TreeSchemasRun) =>
  run.diagnostics.map((d) => [d.rule.replace("seampact/tree/", ""), d.origin.pointer]);
const ref = (schema: string): IrWriter.TypeUse => ({ kind: "ref", schema });

const PUBLIC = `scalars:
  taskCode: { type: string, minLength: 3 }
enums:
  TaskState: { values: [open, done], reason: "Task states." }
  Priority: { values: [low, high], reason: "Priorities." }
schemas:
  Task:
    type: object
    required: [taskId]
    properties: { taskId: { format: taskCode }, state: { enum: TaskState }, owner: Owner }
  Owner: { type: object, properties: { name: { type: string } } }
  Filter: { type: object, properties: { priority: { enum: Priority } } }
  Gone: { type: object, properties: { at: { type: string } } }
`;

// The public api's draft after tree.schemas, with the relayed operation as its tree.nodes would write it.
function publicDraft(): DraftIR {
  const draft = treeSchemasRunApi(PUBLIC).draft;
  const task = draft.schemas.Task;
  const taskId = task?.kind === "object" ? task.properties[0]?.type : undefined;

  if (taskId === undefined) throw new Error("the public Task has no taskId");

  draft.operations.push({
    id: "getTask",
    params: {
      path: [{ name: "taskId", type: taskId, required: true }],
      query: [{ name: "filter", type: ref("Filter"), required: false }],
      header: [],
    },
    responses: [
      { status: 200, body: ref("Task"), shape: "item", headers: [] },
      { status: 410, body: ref("Gone"), shape: "item", headers: [] },
    ],
  });

  return draft;
}

// A public api's draft whose operation `getIt` answers `schema`.
function draftReturning(catalogues: string, schema: string): DraftIR {
  const draft = treeSchemasRunApi(catalogues).draft;

  draft.operations.push({
    id: "getIt",
    responses: [{ status: 200, body: ref(schema), shape: "item", headers: [] }],
  });

  return draft;
}

const RELAY = `surfaces:
  internal:
    routes:
      getTask: { relays: pub.getTask }
`;
const RELAY_IT = RELAY.replace("pub.getTask", "pub.getIt");
const TWO_RELAYS = `surfaces:
  internal:
    routes:
      one: { relays: pa.getIt }
      two: { relays: pb.getIt }
`;
const RELAYS = "/surfaces/internal/routes/getTask/relays";

describe("relay declarations copied", () => {
  test("a declaration the copied shape uses joins the api with its public origin and directions", () => {
    const run = treeSchemasRunApi(RELAY, new Map([["pub", publicDraft()]]));
    const task = run.draft.schemas.Task;

    expect(run.diagnostics).toEqual([]);
    expect(Object.keys(run.draft.schemas)).toEqual(
      expect.arrayContaining(["Task", "Owner", "Filter"]),
    );
    expect(run.draft.schemas.Gone).toBeUndefined();
    expect(task?.origin).toEqual({ api: "pub", layer: "api", pointer: "/schemas/Task" });
    expect(task?.kind === "object" ? task.properties[0]?.origin : undefined).toEqual({
      api: "pub",
      layer: "api",
      pointer: "/schemas/Task/properties/taskId",
    });
    expect(task?.directions).toEqual(["output"]);
    expect(run.draft.schemas.Filter?.directions).toEqual(["input"]);
    expect(run.draft.enums.TaskState?.directions).toEqual(["output"]);
    expect(run.draft.enums.Priority?.directions).toEqual(["input"]);
    expect(run.draft.scalars.taskCode?.directions).toEqual(["input", "output"]);
    expect(run.draft.scalars.taskCode?.origin.api).toBe("pub");
  });

  test("an equal declaration of this api is kept once, a different one is refused naming both", () => {
    const local = `${PUBLIC.replace("TaskState: { values: [open, done]", "TaskState: { values: [open, closed]")}${RELAY}`;
    const run = treeSchemasRunApi(local, new Map([["pub", publicDraft()]]));

    expect(located(run)).toEqual([["relay-declaration", RELAYS]]);
    expect(run.diagnostics[0]?.message).toBe(
      "the enum 'TaskState' that pub.getTask uses differs from the one this api declares",
    );
    expect(run.diagnostics[0]?.related.map((r) => r.origin.pointer)).toEqual(["/enums/TaskState"]);
    expect(run.draft.schemas.Task?.origin).toEqual({ layer: "api", pointer: "/schemas/Task" });
    expect(run.draft.schemas.Task?.directions).toEqual(["output"]);
    expect(run.located).toBe(true);
  });

  test("a copied enum's source enum is copied with it", () => {
    const relayed = new Map([
      [
        "pub",
        draftReturning(
          `enums:
  Base: { values: [a, b], reason: "Base values." }
  Narrow: { source: { enum: Base } }
schemas:
  Box: { type: object, properties: { s: { enum: Narrow } } }
`,
          "Box",
        ),
      ],
    ]);
    const run = treeSchemasRunApi(RELAY_IT, relayed);

    expect(run.diagnostics).toEqual([]);
    expect(Object.keys(run.draft.enums).sort()).toEqual(["Base", "Narrow"]);
    expect(run.draft.enums.Base?.origin.api).toBe("pub");
  });

  test("a rule proof schema of the public operation is not copied", () => {
    const draft = publicDraft();
    const operation = draft.operations[0];

    if (operation === undefined) throw new Error("the public draft has no operation");
    operation.input = {
      media: "application/json",
      schema: ref("Owner"),
      bodyLimitBytes: 1024,
      rawBody: false,
      proofs: [
        {
          name: "ticket",
          schema: ref("Gone"),
          derivedFrom: { derivation: "rule.proof", from: [] },
        },
      ],
      origin: { layer: "api", pointer: "/surfaces/app/routes/getTask/input" },
    };
    const run = treeSchemasRunApi(RELAY, new Map([["pub", draft]]));

    expect(run.diagnostics).toEqual([]);
    expect(run.draft.schemas.Owner?.directions).toEqual(["input", "output"]);
    expect(run.draft.schemas.Gone).toBeUndefined();
  });

  test("a route naming an api that has not run copies nothing", () => {
    const run = treeSchemasRunApi(RELAY);

    expect(run.diagnostics).toEqual([]);
    expect(run.draft.schemas.Task).toBeUndefined();
  });
});

describe("a declaration two relayed apis both use", () => {
  const OWNER_NAME = "Owner: { type: object, properties: { name: { type: string } } }";

  test("is copied once when both declare it the same", () => {
    const relayed = new Map([
      [
        "pa",
        draftReturning(
          `schemas:\n  Box: { type: object, properties: { owner: Owner } }\n  ${OWNER_NAME}\n`,
          "Box",
        ),
      ],
      [
        "pb",
        draftReturning(
          `schemas:\n  Crate: { type: object, properties: { owner: Owner } }\n  ${OWNER_NAME}\n`,
          "Crate",
        ),
      ],
    ]);
    const run = treeSchemasRunApi(TWO_RELAYS, relayed);

    expect(run.diagnostics).toEqual([]);
    expect(run.draft.schemas.Owner?.origin.api).toBe("pa");
  });

  test("is refused when they declare it differently, naming both routes", () => {
    const relayed = new Map([
      [
        "pa",
        draftReturning(
          `schemas:\n  Box: { type: object, properties: { owner: Owner } }\n  ${OWNER_NAME}\n`,
          "Box",
        ),
      ],
      [
        "pb",
        draftReturning(
          `schemas:\n  Crate: { type: object, properties: { owner: Owner } }\n  Owner: { type: object, properties: { id: { type: integer } } }\n`,
          "Crate",
        ),
      ],
    ]);
    const run = treeSchemasRunApi(TWO_RELAYS, relayed);

    expect(located(run)).toEqual([["relay-declaration", "/surfaces/internal/routes/two/relays"]]);
    expect(run.diagnostics[0]?.message).toBe(
      "the schema 'Owner' that pb.getIt uses differs from the one pa.getIt uses",
    );
    expect(run.diagnostics[0]?.related.map((r) => r.origin.pointer)).toEqual([
      "/surfaces/internal/routes/one/relays",
    ]);
    expect(run.draft.schemas.Owner?.origin.api).toBe("pa");
  });
});

describe("written values of two copies of one name", () => {
  const ownerWith = (written: string) =>
    `schemas:\n  Box: { type: object, properties: { owner: Owner } }\n  Owner: { type: object, ${written}, properties: { name: { type: string }, origin: { type: string } } }\n`;
  const ORIGIN_KEY =
    "extensions:\n  acme:\n    origin: { at: [schema], schema: { type: string } }\n";
  const relayPair = (pa: string, pb: string) =>
    treeSchemasRunApi(
      TWO_RELAYS,
      new Map([
        ["pa", draftReturning(pa, "Box")],
        ["pb", draftReturning(pb, "Box")],
      ]),
    );

  test("differ when an example differs only in its 'origin' member", () => {
    const run = relayPair(
      ownerWith("examples: [{ name: a, origin: north }]"),
      ownerWith("examples: [{ name: a, origin: south }]"),
    );

    expect(located(run)).toEqual([["relay-declaration", "/surfaces/internal/routes/two/relays"]]);
  });

  test("differ when a restriction's params differ only in an 'origin' member", () => {
    const withParams = (origin: string) =>
      `schemas:\n  Box: { type: object, properties: { owner: Owner } }\n  Owner: { type: object, properties: { name: { type: string, restrictedTo: { right: notes.read, params: { origin: ${origin} } } } } }\n`;
    const run = relayPair(withParams("north"), withParams("south"));

    expect(located(run)).toEqual([["relay-declaration", "/surfaces/internal/routes/two/relays"]]);
  });

  test("differ when an extension value named 'origin' differs", () => {
    const run = relayPair(
      `${ORIGIN_KEY}${ownerWith("x-acme-origin: north")}`,
      `${ORIGIN_KEY}${ownerWith("x-acme-origin: south")}`,
    );

    expect(located(run)).toEqual([["relay-declaration", "/surfaces/internal/routes/two/relays"]]);
  });
});

describe("extension values of a copied schema", () => {
  const EXTENDED = `extensions:
  acme:
    owner: { at: [schema], schema: { type: string } }
schemas:
  Box: { type: object, x-acme-owner: team, properties: { count: { type: integer } } }
`;

  test("bring their extension key declaration along", () => {
    const run = treeSchemasRunApi(RELAY_IT, new Map([["pub", draftReturning(EXTENDED, "Box")]]));

    expect(run.diagnostics).toEqual([]);
    expect(run.draft.schemas.Box?.extensions).toEqual({ acme: { owner: "team" } });
    expect(run.draft.extensionKeys["acme-owner"]?.origin).toEqual({
      api: "pub",
      layer: "api",
      pointer: "/extensions/acme/owner",
    });
  });

  test("refuse a different declaration of that key in this api", () => {
    const local = `extensions:
  acme:
    owner: { at: [schema, property], schema: { type: string } }
${RELAY_IT}`;
    const run = treeSchemasRunApi(local, new Map([["pub", draftReturning(EXTENDED, "Box")]]));

    expect(located(run)).toEqual([["relay-declaration", RELAYS]]);
    expect(run.diagnostics[0]?.related.map((r) => r.origin.pointer)).toEqual([
      "/extensions/acme/owner",
    ]);
  });
});

// The IR of the public api as an import gives it, with the members a compiled IR holds beside the draft's.
function importedIr(
  draft: DraftIR,
  edit: (ir: Record<string, unknown>) => void = () => {},
): ContractIR {
  const ir: Record<string, unknown> = JSON.parse(JSON.stringify(draft));

  edit(ir);
  const imported: ContractIR = JSON.parse(
    JSON.stringify({ irVersion: "1.0", irRevision: IR_REVISION, kinds: [], features: [], ...ir }),
  );

  return imported;
}

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// An edit of the imported IR as plain JSON: the member at the end of `path` (array indexes as text) set to `value`.
const setAt =
  (path: readonly string[], value: unknown) =>
  (ir: Record<string, unknown>): void => {
    const parent = path.slice(0, -1).reduce<unknown>((node, step) => {
      if (!isJsonObject(node)) throw new Error(`no member ${step} in the imported IR`);

      return node[step];
    }, ir);
    const last = path[path.length - 1];

    if (!isJsonObject(parent) || last === undefined)
      throw new Error(`no member at ${path.join("/")}`);
    parent[last] = value;
  };

describe("relay declarations copied from an import", () => {
  const importing = (edit?: (ir: Record<string, unknown>) => void, catalogues = RELAY) =>
    treeSchemasRunApi(catalogues, new Map(), new Map([["pub", importedIr(publicDraft(), edit)]]));

  test("join the api with the import's origin, as from a workspace api", () => {
    const run = importing();

    expect(run.diagnostics).toEqual([]);
    expect(Object.keys(run.draft.schemas).filter((id) => id !== "Problem")).toEqual(
      expect.arrayContaining(["Task", "Owner", "Filter"]),
    );
    expect(run.draft.schemas.Task?.origin).toEqual({
      api: "pub",
      layer: "api",
      pointer: "/schemas/Task",
    });
    expect(run.draft.enums.TaskState?.directions).toEqual(["output"]);
    expect(run.draft.scalars.taskCode?.origin.api).toBe("pub");
  });

  test("refuse a declaration holding an unknown variant, naming the import, and copy the others", () => {
    const run = importing(
      setAt(["schemas", "Owner", "properties", "0", "type"], { kind: "tuple" }),
    );

    expect(located(run)).toEqual([["relay-unknown", RELAYS]]);
    expect(run.diagnostics[0]?.message).toBe(
      "the schema 'Owner' that pub.getTask uses holds what this compiler does not know ('tuple' at /schemas/Owner/properties/0/type/kind), so it is not copied",
    );
    expect(run.diagnostics[0]?.fix).toBe(
      "compile with a seampact version that reads the IR of pub, or relay another operation",
    );
    expect(run.draft.schemas.Owner).toBeUndefined();
    expect(run.draft.schemas.Task).toBeDefined();
    expect(run.located).toBe(true);
  });

  test("refuse a declaration holding an unknown member", () => {
    const run = importing(setAt(["enums", "TaskState", "weight"], 3));

    expect(located(run)).toEqual([["relay-unknown", RELAYS]]);
    expect(run.diagnostics[0]?.message).toContain("('weight' at /enums/TaskState/weight)");
    expect(run.draft.enums.TaskState).toBeUndefined();
  });

  test("leave alone an unknown member in a declaration the relayed operation does not use", () => {
    const run = importing(setAt(["schemas", "Gone", "weight"], 3));

    expect(run.diagnostics).toEqual([]);
    expect(run.draft.schemas.Task).toBeDefined();
  });

  test("refuse an enum holding an unknown source form", () => {
    const run = importing(setAt(["enums", "TaskState", "source"], { kind: "registry" }));

    expect(located(run)).toEqual([["relay-unknown", RELAYS]]);
    expect(run.diagnostics[0]?.message).toContain("('registry' at /enums/TaskState/source/kind)");
    expect(run.draft.enums.TaskState).toBeUndefined();
  });

  test("refuse a different declaration this api names the same", () => {
    const local = `${PUBLIC.replace("Priority: { values: [low, high]", "Priority: { values: [low, top]")}${RELAY}`;
    const run = importing(undefined, local);

    expect(located(run)).toEqual([["relay-declaration", RELAYS]]);
    expect(run.diagnostics[0]?.message).toBe(
      "the enum 'Priority' that pub.getTask uses differs from the one this api declares",
    );
  });

  test("copy nothing from an operation whose response body use holds an unknown variant", () => {
    const run = importing(
      setAt(["operations", "0", "responses", "0", "body"], { kind: "tuple", schema: "Task" }),
    );

    // tree.nodes refuses the relay route itself, naming the unknown variant.
    expect(run.diagnostics).toEqual([]);
    expect(run.draft.schemas.Task).toBeUndefined();
    expect(run.draft.schemas.Filter).toBeUndefined();
  });
});
