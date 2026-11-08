import { describe, expect, test } from "vitest";
import type { CheckState } from "./access-checks.js";
import { resolvedHooks } from "./boundary-hooks.js";
import { ContractError } from "./contract-error.js";
import type { ContractApi, ContractRoute, FieldRightEntry, ValueShape } from "./contract-route.js";
import { handlerReply } from "./handler-reply.js";

// Restricted output fields (a field right on the response schema) are absent from every holder the response
// shape reaches: table values, array items and arrays nested in arrays.

const OK = 200;
const INTERNAL_CODE = "api.internal";
const FORBIDDEN_CODE = "api.forbidden";
const LEAF: ValueShape = { kind: "leaf" };

const SHAPES: Record<string, ValueShape> = {
  Task: {
    kind: "object",
    properties: { id: LEAF, ownerId: LEAF, effort: LEAF },
  },
  Report: {
    kind: "object",
    properties: {
      rows: { kind: "array", items: { kind: "array", items: { kind: "ref", schema: "Task" } } },
      groups: {
        kind: "array",
        items: { kind: "object", properties: { cost: LEAF, label: LEAF } },
      },
    },
  },
};

function effortRight(pointer: string, schema: string): FieldRightEntry {
  return {
    direction: "output",
    pointer,
    right: "tasks.readEffort",
    schema,
    subject: { type: "Task", source: { in: "holderField", name: "ownerId" } },
    errors: [FORBIDDEN_CODE],
  };
}

function stateFor(
  response: object,
  fieldRights: FieldRightEntry[],
  decide: (ownerId: unknown) => unknown,
): CheckState {
  const route: unknown = {
    id: "listTasks",
    method: "get",
    path: "/tasks",
    safe: true,
    errors: {
      [INTERNAL_CODE]: {
        code: INTERNAL_CODE,
        status: 500,
        nature: "internal",
        roles: ["undeclaredStatus"],
      },
      [FORBIDDEN_CODE]: { code: FORBIDDEN_CODE, status: 403, nature: "forbidden", roles: [] },
    },
    responses: [{ status: OK, payloadPath: [], headers: [], ...response }],
    fieldRights,
  };
  const api: unknown = { id: "tasks", shapes: SHAPES };

  return {
    api: api as ContractApi,
    route: route as ContractRoute,
    request: { method: "GET", path: "/tasks", rawQuery: "", headers: {}, body: undefined },
    pathParams: {},
    hooks: resolvedHooks({
      deciders: [
        {
          names: "all",
          decider: {
            decide: (request) =>
              decide(request.subject?.id) === true
                ? { allow: true }
                : { deny: { code: FORBIDDEN_CODE } },
          },
        },
      ],
    }),
    isFrameworkDenial: () => false,
    fixes: { rawBody: "", bodySize: "" },
  };
}

async function bodyOf(state: CheckState, handlerBody: unknown): Promise<unknown> {
  const reply = await handlerReply(state, { principal: null, scopes: [] }, undefined, {
    status: OK,
    body: handlerBody,
  });

  return JSON.parse(new TextDecoder().decode(reply.body));
}

const mine = (ownerId: unknown): boolean => ownerId === "me";

describe("restricted output fields", () => {
  test("a table response drops the field from each value the caller may not read", async () => {
    const state = stateFor(
      { shape: "table", body: { kind: "ref", schema: "Task" } },
      [effortRight("/effort", "Task")],
      mine,
    );

    const body = await bodyOf(state, {
      a: { id: "a", ownerId: "me", effort: 3 },
      b: { id: "b", ownerId: "other", effort: 5 },
    });

    expect(body).toEqual({
      a: { id: "a", ownerId: "me", effort: 3 },
      b: { id: "b", ownerId: "other" },
    });
  });

  test("a list response drops the field per item, not for the whole list", async () => {
    const state = stateFor(
      { shape: "list", body: { kind: "ref", schema: "Task" } },
      [effortRight("/effort", "Task")],
      mine,
    );

    const body = await bodyOf(state, [
      { id: "a", ownerId: "other", effort: 1 },
      { id: "b", ownerId: "me", effort: 2 },
    ]);

    expect(body).toEqual([
      { id: "a", ownerId: "other" },
      { id: "b", ownerId: "me", effort: 2 },
    ]);
  });

  test("an array of arrays of items drops the field in every inner item", async () => {
    const state = stateFor(
      { shape: "item", body: { kind: "ref", schema: "Report" } },
      [effortRight("/effort", "Task")],
      mine,
    );

    const body = await bodyOf(state, {
      rows: [
        [
          { id: "a", ownerId: "other", effort: 1 },
          { id: "b", ownerId: "me", effort: 2 },
        ],
        [{ id: "c", ownerId: "other", effort: 3 }],
      ],
    });

    expect(body).toEqual({
      rows: [
        [
          { id: "a", ownerId: "other" },
          { id: "b", ownerId: "me", effort: 2 },
        ],
        [{ id: "c", ownerId: "other" }],
      ],
    });
  });

  test("a pointer with a wildcard through an array reaches each element of it", async () => {
    const state = stateFor(
      { shape: "item", body: { kind: "ref", schema: "Report" } },
      [
        {
          ...effortRight("/groups/*/cost", "Report"),
          subject: { type: "Task", source: { in: "holderField", name: "label" } },
        },
      ],
      (label) => label === "public",
    );

    const body = await bodyOf(state, {
      groups: [
        { label: "public", cost: 1 },
        { label: "internal", cost: 2 },
      ],
    });

    expect(body).toEqual({ groups: [{ label: "public", cost: 1 }, { label: "internal" }] });
  });

  test("a decider that throws while projecting a table answers 500, never the field", async () => {
    const state = stateFor(
      { shape: "table", body: { kind: "ref", schema: "Task" } },
      [effortRight("/effort", "Task")],
      () => {
        throw new Error("backend down");
      },
    );

    const failure = await bodyOf(state, { a: { id: "a", ownerId: "me", effort: 3 } }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ContractError);
    expect(failure).toMatchObject({ code: INTERNAL_CODE });
  });

  test("a table body that is not an object is a 500", async () => {
    const state = stateFor({ shape: "table", body: { kind: "ref", schema: "Task" } }, [], mine);

    const failure = await bodyOf(state, [{ id: "a" }]).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: INTERNAL_CODE });
  });
});
