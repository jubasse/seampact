import type { ContractIR, Param } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import type { HandlerAccessBoot } from "./live-handler-access.test-support.js";
import type { ReferenceIrChange } from "./reference-project.test-support.js";

// The booted query list tests of the Node server targets: a list query param in the default form
// (`conventions.query.lists: repeat`, `tag=a&tag=b`) reaches the handler as the list of its values, decoded from the
// raw query string (ADR 0002 section 7), while a scalar param sent twice stays refused.

const LIST_OPERATION = "health";
const LIST_PARAM = "tag";
const SCALAR_PARAM = "label";
const NUMBER_LIST_PARAM = "score";
const BAD_REQUEST = 400;

const TEXT = { kind: "scalar", type: "string", refinements: {} } as const;

const REPEATED_LIST_PARAM: Param = {
  name: LIST_PARAM,
  required: false,
  type: { kind: "array", items: TEXT },
  wire: { kind: "list", style: "form", explode: true, brackets: false },
};

const REPEATED_NUMBER_LIST_PARAM: Param = {
  name: NUMBER_LIST_PARAM,
  required: false,
  type: { kind: "array", items: { kind: "scalar", type: "integer", refinements: {} } },
  wire: { kind: "list", style: "form", explode: true, brackets: false },
};

const SCALAR_TEXT_PARAM: Param = {
  name: SCALAR_PARAM,
  required: false,
  type: TEXT,
  wire: { kind: "text", style: "form", explode: true, brackets: false },
};

/**
 * Gives the `tasks` api's public `health` route a text list and an integer list query param in the default form, and
 * a scalar one.
 */
export const referenceRepeatedQueryList: ReferenceIrChange = (ir: ContractIR, api: string) => {
  if (api !== "tasks") return ir;

  return {
    ...ir,
    operations: ir.operations.map((operation) =>
      operation.id === LIST_OPERATION
        ? {
            ...operation,
            params: {
              ...operation.params,
              query: [
                ...operation.params.query,
                REPEATED_LIST_PARAM,
                REPEATED_NUMBER_LIST_PARAM,
                SCALAR_TEXT_PARAM,
              ],
            },
          }
        : operation,
    ),
  };
};

// Records the query each `health` call receives, then answers as the scenario's default does.
function receivedQueries(boot: HandlerAccessBoot): unknown[] {
  const queries: unknown[] = [];

  boot.app.scenario.answers[LIST_OPERATION] = (input) => {
    queries.push(typeof input === "object" && input !== null ? Reflect.get(input, "query") : input);

    return { status: 200, body: { status: "ok" } };
  };

  return queries;
}

/** The query list tests of a test app serving the reference changed by `referenceRepeatedQueryList`. */
export function describeRepeatedQueryList(booted: () => HandlerAccessBoot): void {
  test("a list sent as repeated keys reaches the handler as the list of its values", async () => {
    const boot = booted();
    const queries = receivedQueries(boot);
    const statuses: number[] = [];

    for (const query of ["?tag=a&tag=b", "?tag=a", "?tag=a%2Cb&tag=c+d", ""]) {
      const reply = await boot.send("GET", `/v1/health${query}`, {});

      statuses.push(reply.status);
    }

    expect(statuses).toEqual([200, 200, 200, 200]);
    expect(queries).toEqual([
      { tag: ["a", "b"] },
      { tag: ["a"] },
      { tag: ["a,b", "c d"] },
      expect.not.objectContaining({ tag: expect.anything() }),
    ]);
  });

  test("each item of a list is decoded by its type", async () => {
    const boot = booted();
    const queries = receivedQueries(boot);
    const reply = await boot.send("GET", "/v1/health?score=1&score=20", {});

    expect(reply.status).toBe(200);
    expect(queries).toEqual([{ score: [1, 20] }]);
  });

  test("a scalar param sent as repeated keys is refused before the handler", async () => {
    const boot = booted();
    const queries = receivedQueries(boot);
    const reply = await boot.send("GET", "/v1/health?label=a&label=b", {});

    expect(reply.status).toBe(BAD_REQUEST);
    expect(queries).toEqual([]);
  });
}
