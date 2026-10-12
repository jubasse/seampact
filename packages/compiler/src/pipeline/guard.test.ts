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
// A catalogue key, held in a variable: written literally, `x["__proto__"]` reads like the accessor.
const PROTO = "__proto__";
const task = (): IrWriter.Schema => ({
  kind: "object",
  id: "Task",
  name: { segments: ["task"], role: "schema" },
  properties: [],
  directions: ["output"],
  examples: [],
  docs: {},
  extensions: {},
  origin,
});

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
    value.schemas.Task = task();
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

  test("an operation's features are finalize's, computed from the members present", () => {
    const guarded = pipelineGuard(draft(), part("derive.wire", [], ["operations[].features"]));
    const error = refused(() => Object.assign(operationOf(guarded), { features: [] }));
    expect(error).toMatchObject({ field: "operations[].features", owner: "finalize" });
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

// The guard catches mistakes of our own pass lanes, not an adversary; these are the ways a write could still
// slip past its checks by accident.
describe("guard refuses writes around its checks", () => {
  test("a symbol key is no draft member: set, defineProperty and delete are refused", () => {
    const value = draft();
    const guarded = pipelineGuard(value, part("tree.nodes", [], ["operations[].docs"]));
    const operation = operationOf(guarded);
    const key = Symbol("note");
    expect(refused(() => Reflect.set(operation, key, 1)).message).toContain("symbol");
    expect(refused(() => Object.defineProperty(operation, key, { value: 1 })).access).toBe(
      "write",
    );
    expect(refused(() => Reflect.deleteProperty(operation, key)).access).toBe("write");
    expect(Object.getOwnPropertySymbols(operationOf(value))).toEqual([]);
  });

  test("an accessor descriptor is refused, even on a field the half owns", () => {
    const value = draft();
    const guarded = pipelineGuard(value, part("derive.wire", [], ["operations[].cache"]));
    const accessor = refused(() =>
      Object.defineProperty(operationOf(guarded), "cache", { get: () => undefined }),
    );
    expect(accessor.message).toContain("accessor");
    expect(Object.hasOwn(operationOf(value), "cache")).toBe(false);
  });

  test("changing a prototype or preventing extensions through a guard is refused", () => {
    const value = draft();
    const guarded = pipelineGuard(value, part("tree.nodes", [], ["operations[]"]));
    expect(refused(() => Object.setPrototypeOf(operationOf(guarded), null)).access).toBe("write");
    expect(refused(() => Object.preventExtensions(guarded.operations)).access).toBe("write");
    expect(refused(() => Object.freeze(operationOf(guarded))).access).toBe("write");
    expect(Object.getPrototypeOf(operationOf(value))).toBe(Object.prototype);
    expect(Object.isExtensible(value.operations)).toBe(true);
  });

  test("an array length is coerced before the check, as the array coerces it", () => {
    const value = draft();
    const wire = pipelineGuard(value, part("derive.wire", [], ["operations[].params.query"]));
    const list = operationOf(wire).params?.query;
    if (list === undefined) throw new Error("no query list");
    expect(refused(() => Reflect.set(list, "length", "0")).message).toContain(
      "owned by tree.nodes (declared)",
    );
    expect(
      refused(() => Object.defineProperty(list, "length", { value: 0 })).message,
    ).toContain("owned by tree.nodes (declared)");
    expect(operationOf(value).params?.query).toHaveLength(1);
    expect(() => Reflect.set(list, "length", -1)).toThrow(RangeError);
  });

  test("a prototype key reads only as an own member", () => {
    const value = draft();
    operationOf(value).docs = {};
    const guarded = pipelineGuard(value, part("tree.nodes", [], ["operations[]"]));
    const operation = operationOf(guarded);
    const docs = operation.docs ?? {};
    expect(refused(() => Reflect.get(docs, "__proto__")).message).toContain("prototype");
    expect(refused(() => Reflect.get(operation, "constructor")).path).toBe(
      "operations[0].constructor",
    );
    expect(refused(() => Reflect.get(operation, "prototype")).access).toBe("read");
    // Array methods read `constructor` (species): it passes on a list.
    expect(guarded.operations.map((entry) => entry.id)).toEqual(["createTask"]);

    const rights = draft();
    rights.rights[PROTO] = {
      id: "__proto__",
      subject: { kind: "none" },
      errors: [],
      docs: {},
      extensions: {},
      origin,
    };
    const reader = pipelineGuard(rights, part("access.rights", [], ["rights"]));
    expect(reader.rights[PROTO]?.id).toBe("__proto__");
    expect(Object.hasOwn(reader.rights, "__proto__")).toBe(true);
  });

  test("writing a prototype key adds an own member and never changes the prototype", () => {
    const value = draft();
    operationOf(value).docs = {};
    const guarded = pipelineGuard(value, part("tree.nodes", [], ["operations[]"]));
    Reflect.set(operationOf(guarded).docs ?? {}, "__proto__", { polluted: true });
    const docs = operationOf(value).docs ?? {};
    expect(Object.getPrototypeOf(docs)).toBe(Object.prototype);
    expect(Object.hasOwn(docs, "__proto__")).toBe(true);
  });

  test("an unwrapped copy keeps its prototype and its `__proto__` member", () => {
    const value = draft();
    value.schemas.Task = task();
    const guarded = pipelineGuard(value, part("tree.schemas", [], ["schemas"]));
    const entry = guarded.schemas.Task;
    if (entry === undefined) throw new Error("no schema");
    const replacement: Record<string, IrWriter.Schema> = Object.create(null);
    replacement[PROTO] = entry;
    replacement.Task = entry;
    guarded.schemas = replacement;
    expect(Object.getPrototypeOf(value.schemas)).toBeNull();
    expect(Object.hasOwn(value.schemas, "__proto__")).toBe(true);
    expect(value.schemas[PROTO]).toBe(value.schemas.Task);
    expect(value.schemas === replacement, "the copy, not the object holding guards").toBe(false);
  });

  test("a catalogue assigned whole has no prototype, and is never removed", () => {
    const value = draft();
    const guarded = pipelineGuard(value, part("tree.schemas", [], ["schemas"]));
    expect(refused(() => Object.assign(guarded, { schemas: { Task: task() } })).message).toContain(
      "Object.create(null)",
    );
    expect(refused(() => Reflect.deleteProperty(guarded, "schemas")).path).toBe("schemas");
    expect(Object.getPrototypeOf(value.schemas)).toBeNull();
  });

  test("a frozen property reads as its own value, as a proxy must", () => {
    const value = draft();
    const input = operationOf(value).input;
    if (input === undefined) throw new Error("no input");
    Object.freeze(input);
    const guarded = pipelineGuard(value, part("access.identity", ["operations[].input"], []));
    expect(operationOf(guarded).input?.schema).toBe(input.schema);
  });
});
