import { expect, test } from "vitest";
import { loadWorkspace } from "../load/index.js";
import { loadMemoryReader } from "../load/reader.js";
import type { RawApi } from "../raw-tree.js";
import { pipelineInherited } from "./inherited.js";
import { pipelineOrigin } from "./pointer.js";
import { type TreeNode, pipelineTreeNodes } from "./tree.js";

const API = `
api: { name: a, version: 1 }
surfaces:
  app:
    prefix: /v{version}
    identity: user
    tags: [app]
    requires: [r1]
    errorRoles: { notFound: a.missing, forbidden: a.denied }
    errors: { app.gone: { reach: resource } }
    routes:
      tasks:
        kind: collection
        id: { taskId: TaskId }
        tags: [app, tasks]
        errors: { app.gone: { reach: resource }, tasks.locked: {} }
        requires: [r2]
        ops: { list: {}, get: { identity: admin, tags: [read] } }
        member:
          scopes: { task: path.taskId }
          errorRoles: { notFound: a.noTask }
          routes:
            assign: { method: post, requires: [r3], scopes: { project: path.projectId } }
      labels:
        kind: collection
        id: { labelId: LabelId }
        ops: [get, list]
      me:
        kind: single
        ops: [get]
        routes:
          avatar: { method: get }
      hook: { relays: b.getTask }
`;

function rawApi(): RawApi {
  const loaded = loadWorkspace({ reader: loadMemoryReader({ "a.yaml": API }), entry: "a.yaml" });
  expect(loaded.diagnostics).toEqual([]);
  const api = loaded.workspace.apis[0];
  if (api === undefined) throw new Error("no api");
  return api;
}

const raw = rawApi();
const nodes = pipelineTreeNodes(raw);
const inherited = pipelineInherited(raw);
const at = (pointer: string): TreeNode => {
  const node = nodes.find((n) => n.pointer === pointer);
  if (node === undefined) throw new Error(`no node at ${pointer}`);
  return node;
};
const TASKS = "/surfaces/app/routes/tasks";
const LABELS = "/surfaces/app/routes/labels";
const get = at(`${TASKS}/ops/get`);
const list = at(`${TASKS}/ops/list`);
const assign = at(`${TASKS}/member/routes/assign`);

test("tree nodes in document order, op entries under their scope", () => {
  expect(nodes.map((n) => [n.kind, n.name, n.pointer, n.parent?.pointer])).toEqual([
    ["surface", "app", "/surfaces/app", undefined],
    ["collection", "tasks", TASKS, "/surfaces/app"],
    ["scope", "collection", `${TASKS}/collection`, TASKS],
    ["op", "list", `${TASKS}/ops/list`, `${TASKS}/collection`],
    ["scope", "member", `${TASKS}/member`, TASKS],
    ["op", "get", `${TASKS}/ops/get`, `${TASKS}/member`],
    ["route", "assign", `${TASKS}/member/routes/assign`, `${TASKS}/member`],
    ["collection", "labels", LABELS, "/surfaces/app"],
    ["scope", "collection", `${LABELS}/collection`, LABELS],
    ["op", "list", `${LABELS}/ops/1`, `${LABELS}/collection`],
    ["scope", "member", `${LABELS}/member`, LABELS],
    ["op", "get", `${LABELS}/ops/0`, `${LABELS}/member`],
    ["single", "me", "/surfaces/app/routes/me", "/surfaces/app"],
    ["op", "get", "/surfaces/app/routes/me/ops/0", "/surfaces/app/routes/me"],
    ["route", "avatar", "/surfaces/app/routes/me/routes/avatar", "/surfaces/app/routes/me"],
    ["relay", "hook", "/surfaces/app/routes/hook", "/surfaces/app"],
  ]);
  // A scope not written takes its collection's origin; a written one and an `ops` list entry their own.
  expect(at(`${TASKS}/collection`).origin).toEqual({ layer: "api", pointer: TASKS });
  expect(at(`${TASKS}/member`).origin).toEqual({ layer: "api", pointer: `${TASKS}/member` });
  expect(at(`${LABELS}/ops/1`).origin).toEqual({ layer: "api", pointer: `${LABELS}/ops/1` });
  expect(at(`${LABELS}/ops/1`).settings).toEqual({});
  expect(Object.isFrozen(nodes) && nodes.every((n) => Object.isFrozen(n))).toBe(true);
});

test("origins of nodes, leaves, list items and absent pointers", () => {
  expect(pipelineOrigin(raw, "/surfaces/app/identity")).toEqual({
    layer: "api",
    pointer: "/surfaces/app/identity",
  });
  expect(pipelineOrigin(raw, "/surfaces/app/tags/0")).toEqual({
    layer: "api",
    pointer: "/surfaces/app/tags/0",
  });
  expect(pipelineOrigin(raw, "/surfaces/app/nothing")).toBeUndefined();
  expect(pipelineOrigin(raw, "no-slash")).toBeUndefined();
});

test("inherited merge shapes", () => {
  const pointers = (entries: readonly { origin: { pointer: string } }[]) =>
    entries.map((e) => e.origin.pointer);

  // nearest: the op's own setting wins, else the surface's.
  expect(inherited(get, "identity")?.entry).toMatchObject({
    value: "admin",
    origin: { layer: "api", pointer: `${TASKS}/ops/get/identity` },
    node: get,
  });
  expect(inherited(list, "identity")?.entry.origin.pointer).toBe("/surfaces/app/identity");
  expect(inherited(list, "csrf")).toBeUndefined();

  // A setting on the member scope reaches `get`, not `list`.
  expect(inherited(get, "scopes")?.entries.map((e) => [e.key, e.value])).toEqual([
    ["task", "path.taskId"],
  ]);
  expect(inherited(list, "scopes")).toBeUndefined();

  // ordered: every entry from the root down, each with its origin; a map entry carries its key.
  const requires = inherited(assign, "requires");
  expect(requires?.shape).toBe("ordered");
  expect(requires?.entries.map((e) => e.value)).toEqual(["r1", "r2", "r3"]);
  expect(pointers(requires?.entries ?? [])).toEqual([
    "/surfaces/app/requires/0",
    `${TASKS}/requires/0`,
    `${TASKS}/member/routes/assign/requires/0`,
  ]);
  expect(inherited(assign, "scopes")?.entries.map((e) => [e.key, e.node.name])).toEqual([
    ["task", "member"],
    ["project", "assign"],
  ]);

  // union: an equal entry set again is dropped, the first setter's origin kept.
  const tags = inherited(get, "tags");
  expect(tags?.shape).toBe("union");
  expect(tags?.entries.map((e) => e.value)).toEqual(["app", "tasks", "read"]);
  expect(pointers(tags?.entries ?? [])).toEqual([
    "/surfaces/app/tags/0",
    `${TASKS}/tags/1`,
    `${TASKS}/ops/get/tags/0`,
  ]);

  // errors: every attachment is kept with its node, an equal one re-attached on a nested node included, so
  // derive.errors applies `reach: resource` to each (the root's stops at its own resource, the nested one's
  // reaches `get`).
  const errors = inherited(get, "errors");
  expect(errors?.shape).toBe("union");
  expect(errors?.entries.map((e) => [e.key, e.value, e.node.name, e.origin.pointer])).toEqual([
    ["app.gone", { reach: "resource" }, "app", "/surfaces/app/errors/app.gone"],
    ["app.gone", { reach: "resource" }, "tasks", `${TASKS}/errors/app.gone`],
    ["tasks.locked", {}, "tasks", `${TASKS}/errors/tasks.locked`],
  ]);

  // per key: the nearest node wins for each key.
  const roles = inherited(assign, "errorRoles");
  expect(roles?.shape).toBe("perKey");
  expect([...(roles?.entries ?? [])].map(([key, e]) => [key, e.value, e.origin.pointer])).toEqual([
    ["notFound", "a.noTask", `${TASKS}/member/errorRoles/notFound`],
    ["forbidden", "a.denied", "/surfaces/app/errorRoles/forbidden"],
  ]);

  // Results are frozen, the per-key map included.
  expect(Object.isFrozen(requires) && Object.isFrozen(requires?.entries[0])).toBe(true);
  expect(Object.isFrozen(roles?.entries)).toBe(true);
  expect("set" in (roles?.entries ?? {})).toBe(false);

  // @ts-expect-error `owner` is not inherited (ADR 0002 section 8).
  expect(() => inherited(get, "owner")).toThrow(/no merge shape/);
});

test("a union entry's identity ignores key order", () => {
  // A hand-made merged tree: the readers are generic over the values, and no union setting of the grammar holds
  // objects yet.
  const merged = {
    surfaces: {
      app: {
        tags: [{ a: 1, b: [{ c: 1, d: 2 }] }, "app"],
        routes: { ping: { method: "get", tags: [{ b: [{ d: 2, c: 1 }], a: 1 }, "ping"] } },
      },
    },
  };
  const handMade: RawApi = { ...raw, merged, leafOrigins: {} };
  const ping = pipelineTreeNodes(handMade).find((n) => n.name === "ping");
  if (ping === undefined) throw new Error("no ping");
  const tags = pipelineInherited(handMade)(ping, "tags");
  expect(tags?.entries.map((e) => [e.value, e.node.name])).toEqual([
    [{ a: 1, b: [{ c: 1, d: 2 }] }, "app"],
    ["app", "app"],
    ["ping", "ping"],
  ]);
});
