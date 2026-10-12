import type { IrWriter } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { createDraftIR, type DraftIR, type DraftOperation } from "./draft.js";
import { DraftAccessError, type GuardedPart, pipelineGuard as revocableGuard } from "./guard.js";

// The guarded draft of a guard whose disposal the test does not exercise.
const pipelineGuard = <D extends DraftIR>(value: D, guarded: GuardedPart): D =>
  revocableGuard(value, guarded).draft;

const origin: IrWriter.Origin = { layer: "api", pointer: "/surfaces/app/routes/tasks" };
const text: IrWriter.TypeUse = { kind: "scalar", type: "string", refinements: {} };
const derivedFrom = (derivation: string): IrWriter.DerivedFrom => ({ derivation, from: [origin] });

// A draft after the tree pass, with one operation: a declared query parameter and one declared response.
function draft(): DraftIR {
  const result = createDraftIR();
  const operation: DraftOperation = {
    kind: "httpOperation",
    id: "createTask",
    method: "post",
    params: {
      path: [],
      query: [{ name: "dryRun", type: text, required: false, origin }],
      header: [],
    },
    input: { media: "application/json", schema: { kind: "ref", schema: "NewTask" }, origin },
    responses: [{ status: 201, shape: "item", headers: [], origin }],
    paging: { overLimit: "reject", sortKeys: [{ key: "title", origin }], origin },
    origin,
  };
  result.operations.push(operation);
  return result;
}

const operationOf = (value: DraftIR): DraftOperation => {
  const operation = value.operations[0];
  if (operation === undefined) throw new Error("no operation");
  return operation;
};

function refused(run: () => void): DraftAccessError {
  try {
    run();
  } catch (error) {
    if (error instanceof DraftAccessError) return error;
    throw error;
  }
  throw new Error("expected a DraftAccessError");
}

const part = (
  half: GuardedPart["half"],
  reads: GuardedPart["reads"],
  writes: GuardedPart["writes"],
): GuardedPart => ({ half, reads, writes });

describe("guard refuses undeclared access", () => {
  test("an undeclared read names the half, the path and the owner", () => {
    const guarded = pipelineGuard(draft(), part("access.rights", ["operations[].requires"], []));
    const error = refused(() => operationOf(guarded).cache);
    expect(error).toMatchObject({
      half: "access.rights",
      access: "read",
      path: "operations[0].cache",
      field: "operations[].cache",
      owner: "derive.wire",
    });
    expect(error.message).toContain("access.rights read operations[0].cache");
  });

  test("navigating through the containers above a declared field is allowed", () => {
    const guarded = pipelineGuard(
      draft(),
      part("access.identity", [], ["operations[].input.rawBody"]),
    );
    const input = operationOf(guarded).input;
    expect(input?.rawBody).toBeUndefined();
    expect(refused(() => input?.media).field).toBe("operations[].input.media");
    expect(refused(() => guarded.schemas).owner).toBe("tree.schemas");
  });

  test("a read of a catalogue entry and Object.hasOwn go through the catalogue's field", () => {
    const value = draft();
    value.schemas.Task = {
      kind: "object",
      id: "Task",
      name: { segments: ["task"], role: "schema" },
      properties: [],
      directions: ["output"],
      examples: [],
      docs: {},
      extensions: {},
      origin,
    };
    const guarded = pipelineGuard(value, part("tree.nodes", ["schemas"], []));
    expect(Object.hasOwn(guarded.schemas, "Task")).toBe(true);
    expect(guarded.schemas.Task?.kind).toBe("object");
    expect(refused(() => Object.hasOwn(guarded.rights, "x")).field).toBe("rights");
  });

  test("an undeclared write, and a declared write to another half's field, are refused", () => {
    const guarded = pipelineGuard(draft(), part("access.identity", [], ["operations[].csrf"]));
    const outside = refused(() => {
      operationOf(guarded).callerKinds = ["anonymous"];
    });
    expect(outside).toMatchObject({ access: "write", owner: "access.identity" });
    expect(outside.message).toContain("outside its writes");

    const tree = pipelineGuard(draft(), part("tree.nodes", [], ["operations[].errors"]));
    const owned = refused(() => {
      operationOf(tree).errors = [];
    });
    expect(owned).toMatchObject({
      half: "tree.nodes",
      path: "operations[0].errors",
      owner: "derive.errors",
    });
  });

  test("a write to an element owned by another half, by derivedFrom.derivation, is refused", () => {
    const value = draft();
    const wire = pipelineGuard(value, part("derive.wire", [], ["operations[].params.header"]));
    const header = operationOf(wire).params?.header;
    header?.push({
      name: "Idempotency-Key",
      type: text,
      required: true,
      derivedFrom: derivedFrom("idempotency.write"),
    });
    expect(operationOf(value).params?.header).toHaveLength(1);
    const relay = refused(() =>
      header?.push({
        name: "X",
        type: text,
        required: true,
        derivedFrom: derivedFrom("relay.route"),
      }),
    );
    expect(relay.message).toContain("owned by tree.nodes (derivation relay.route)");
    const unknown = refused(() =>
      header?.push({ name: "Y", type: text, required: true, derivedFrom: derivedFrom("no.such") }),
    );
    expect(unknown.message).toContain("has no owner");

    const query = pipelineGuard(value, part("derive.wire", [], ["operations[].params.query"]));
    const declared = operationOf(query).params?.query[0];
    expect(refused(() => Object.assign(declared ?? {}, { required: true })).message).toContain(
      "owned by tree.nodes (declared)",
    );
    const own = operationOf(wire).params?.header[0];
    if (own?.derivedFrom === undefined) throw new Error("no derived header");
    const derivation = own.derivedFrom;
    expect(
      refused(() => Object.assign(derivation, { derivation: "relay.route" })).message,
    ).toContain("after the write is owned by tree.nodes");
    // Removing another half's elements writes them.
    expect(() => {
      const list = operationOf(query).params?.query;
      if (list) list.length = 0;
    }).toThrow(DraftAccessError);
  });

  test("a default is written only where absent, by the halves of its order", () => {
    const value = draft();
    const wire = pipelineGuard(
      value,
      part("derive.wire", ["operations[].input.schema"], ["operations[].input.schema.unknownKeys"]),
    );
    const schema = operationOf(wire).input?.schema;
    if (schema?.kind !== "ref") throw new Error("no ref input");
    schema.unknownKeys = {
      policy: "ignore",
      reason: "Clients add fields.",
      derivedFrom: derivedFrom("input.unknownKeys"),
    };
    expect(
      refused(() => Object.assign(schema, { unknownKeys: { policy: "keep" } })).message,
    ).toContain("only where absent");
    const reason = refused(() => {
      if (schema.unknownKeys) schema.unknownKeys.reason = "Other.";
    });
    expect(reason.field).toBe("operations[].input.schema.unknownKeys");

    const rights = pipelineGuard(
      draft(),
      part("access.rights", [], ["operations[].input.schema.unknownKeys"]),
    );
    const other = operationOf(rights).input?.schema;
    expect(
      refused(() => Object.assign(other ?? {}, { unknownKeys: { policy: "keep" } })).message,
    ).toContain("tree.nodes, access.identity, derive.wire");
  });

  test("writing a container checks each row it changes", () => {
    const value = draft();
    const tree = pipelineGuard(value, part("tree.nodes", [], ["operations[]"]));
    const fresh: DraftOperation = { kind: "httpOperation", id: "getTask", method: "get", origin };
    tree.operations.push(fresh);
    expect(value.operations[1]).toBe(fresh);
    const withErrors = refused(() => tree.operations.push({ ...fresh, id: "x", errors: [] }));
    expect(withErrors).toMatchObject({ path: "operations[2].errors", owner: "derive.errors" });

    const identity = pipelineGuard(
      value,
      part("access.identity", ["operations[].input"], ["operations[].input.rawBody"]),
    );
    const operation = operationOf(identity);
    if (operation.input === undefined) throw new Error("no input");
    operation.input = { ...operation.input, rawBody: true };
    const written = operationOf(value).input;
    expect(written?.rawBody).toBe(true);
    // The draft never holds a guard: the copied schema is the original object.
    expect(written?.schema).toEqual({ kind: "ref", schema: "NewTask" });
    expect(refused(() => Object.assign(operation, { input: undefined })).field).toBe(
      "operations[].input.media",
    );
  });

  test("sort keys: access.rights writes the right of a key tree.nodes declared, not the key", () => {
    const value = draft();
    const rights = pipelineGuard(
      value,
      part("access.rights", [], ["operations[].paging.sortKeys[].right"]),
    );
    const keys = operationOf(rights).paging?.sortKeys;
    const key = keys?.[0];
    if (key === undefined) throw new Error("no sort key");
    key.right = "tasks.read";
    expect(operationOf(value).paging?.sortKeys[0]?.right).toBe("tasks.read");
    expect(refused(() => keys?.push({ key: "due", right: "x" })).field).toBe(
      "operations[].paging.sortKeys[].key",
    );
  });

  test("response headers: a derived header joins a declared response, not the other way", () => {
    const value = draft();
    const wire = pipelineGuard(
      value,
      part("derive.wire", [], ["operations[].responses[].headers"]),
    );
    operationOf(wire).responses?.[0]?.headers.push({
      name: "ETag",
      type: text,
      required: true,
      derivedFrom: derivedFrom("concurrency.version"),
    });
    expect(operationOf(value).responses?.[0]?.headers).toHaveLength(1);
    const tree = pipelineGuard(value, part("tree.nodes", [], ["operations[].responses"]));
    const responses = operationOf(tree).responses;
    const replaced = refused(() => {
      if (responses) responses[0] = { status: 201, shape: "item", headers: [], origin };
    });
    expect(replaced.field).toBe("operations[].responses[].headers");
    // Its own members stay the declared response's owner's to write.
    if (responses?.[0]) responses[0].status = 200;
    expect(operationOf(value).responses?.[0]?.status).toBe(200);
  });

  test("the link pass is read-only by guard", () => {
    const guarded = pipelineGuard(draft(), part("link", ["operations[]"], []));
    expect(JSON.parse(JSON.stringify(guarded.operations))[0].id).toBe("createTask");
    expect(refused(() => Object.assign(operationOf(guarded), { id: "x" })).message).toContain(
      "outside its writes",
    );
  });

  test("dispose revokes every guard of the half, so a retained one throws", () => {
    const guard = revocableGuard(draft(), part("tree.nodes", ["operations[]"], []));
    const operation = operationOf(guard.draft);
    const operations = guard.draft.operations;
    expect(operation.id).toBe("createTask");
    guard.dispose();
    expect(() => operation.id).toThrow(TypeError);
    expect(() => operations.length).toThrow(TypeError);
    expect(() => guard.dispose()).not.toThrow();
  });
});
