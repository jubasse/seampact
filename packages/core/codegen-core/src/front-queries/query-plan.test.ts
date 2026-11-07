import { readFileSync } from "node:fs";
import type { ContractIR } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import type { ClientDescriptor } from "../descriptors.js";
import { planQueries, type QueryOperation, type QueryPlanSettings } from "./query-plan.js";

const GOLDEN = new URL("../../../../../fixtures/golden/", import.meta.url);
const INFINITE_ON: QueryPlanSettings = { infinite: true };

function goldenIr(pack: string, api: string): ContractIR {
  return JSON.parse(readFileSync(new URL(`${pack}/${api}.ir.json`, GOLDEN), "utf8"));
}

// The client descriptor `codegen-fetch` writes: one method per operation, named after the operation id here.
function clientOf(
  ir: ContractIR,
  methods: Readonly<Record<string, string>> = {},
): ClientDescriptor {
  return {
    kind: "client",
    style: "fetch",
    errorStyle: "result",
    exports: {
      createClient: { module: "index", export: "createClient" },
      Client: { module: "index", export: "Client" },
      ContractError: { module: "index", export: "ContractError" },
      CallOptions: { module: "index", export: "CallOptions" },
    },
    operations: Object.fromEntries(
      ir.operations.map((operation) => [
        operation.id,
        { method: methods[operation.id] ?? operation.id },
      ]),
    ),
  };
}

function plannedOperations(ir: ContractIR, settings = INFINITE_ON): Map<string, QueryOperation> {
  const outcome = planQueries(ir, clientOf(ir), settings);

  if (outcome.status !== "planned") throw new Error(JSON.stringify(outcome.refusals));

  return new Map(outcome.plan.operations.map((operation) => [operation.operationId, operation]));
}

function plannedOperation(operations: Map<string, QueryOperation>, id: string): QueryOperation {
  const operation = operations.get(id);

  if (operation === undefined) throw new Error(`no planned operation '${id}'`);

  return operation;
}

test("a safe paged operation is a query with an infinite query on its cursor", () => {
  const listTasks = plannedOperation(
    plannedOperations(goldenIr("reference", "tasks")),
    "listTasks",
  );

  expect(listTasks).toMatchObject({
    form: "query",
    resource: "tasks",
    names: {
      base: "listTasks",
      options: "listTasksOptions",
      hook: "useListTasks",
      infinite: {
        options: "listTasksInfiniteOptions",
        hook: "useListTasksInfinite",
        key: "listTasksInfinite",
      },
    },
    nextPage: { position: "cursor", member: { in: "query", key: "cursor" } },
    filledHeaderKeys: [],
  });
});

test("an unsafe operation is a mutation with its idempotency header filled by the client", () => {
  const createTask = plannedOperation(
    plannedOperations(goldenIr("reference", "tasks")),
    "createTask",
  );

  expect(createTask).toMatchObject({
    form: "mutation",
    names: { options: "createTaskMutationOptions", hook: "useCreateTask" },
    resource: "tasks",
    filledHeaderKeys: ["idempotency-key"],
    idempotencyHeaderKey: "idempotency-key",
    needsTimeout: false,
  });
  expect(createTask.nextPage).toBeUndefined();
});

test("a safe operation with a body is a query, and one without a resource has none", () => {
  const operations = plannedOperations(goldenIr("reference", "tasks"));

  expect(plannedOperation(operations, "getTasksBatch").form).toBe("query");
  expect(plannedOperation(operations, "health").resource).toBeUndefined();
});

test("freshness is the contract's max-age, and 0 for an operation without cache directives", () => {
  const operations = plannedOperations(goldenIr("reference", "tasks"));

  expect(plannedOperation(operations, "getPreferences").freshnessMs).toBe(60_000);
  expect(plannedOperation(operations, "getTask").freshnessMs).toBe(0);
});

test("a deadline header without a budget needs a timeout and is filled by the client", () => {
  const getTask = plannedOperation(
    plannedOperations(goldenIr("reference", "tasksService")),
    "getTask",
  );

  expect(getTask).toMatchObject({ needsTimeout: true, filledHeaderKeys: ["x-deadline"] });
});

test("a page style moves its page number while its facts say a page follows", () => {
  const listTasks = plannedOperation(
    plannedOperations(goldenIr("pack-laravel", "tasks")),
    "listTasks",
  );

  expect(listTasks.nextPage).toMatchObject({
    position: "page",
    member: { in: "query", key: "page" },
    limit: { in: "query", key: "per_page" },
    base: 1,
  });
  expect(
    listTasks.nextPage?.position === "page" && listTasks.nextPage.evidence.length,
  ).toBeGreaterThan(0);
});

test("a paged operation whose style gives no next position keeps its plain query, with a warning", () => {
  const ir = goldenIr("pack-laravel", "tasks");
  const style = Object.values(ir.pagings)[0];

  if (style === undefined) throw new Error("the laravel pack declares no paging style");

  style.response = {
    body: { kind: "slot", slot: "items", path: [] },
    meta: [],
    headers: [],
    links: [],
  };

  const outcome = planQueries(ir, clientOf(ir), INFINITE_ON);

  if (outcome.status !== "planned") throw new Error(JSON.stringify(outcome.refusals));

  const listTasks = outcome.plan.operations.find(
    (operation) => operation.operationId === "listTasks",
  );

  expect(listTasks?.names.infinite).toBeUndefined();
  expect(outcome.warnings).toContainEqual(
    expect.objectContaining({ code: "paging.infinite.skipped", operation: "listTasks" }),
  );
});

test("a since style gets no infinite query, with a warning naming why", () => {
  const ir = goldenIr("reference", "tasks");
  const style = Object.values(ir.pagings)[0];

  if (style === undefined) throw new Error("the reference declares no paging style");

  style.position = "since";

  const outcome = planQueries(ir, clientOf(ir), INFINITE_ON);

  expect(
    outcome.status === "planned" && outcome.warnings.map((warning) => warning.message),
  ).toContainEqual(expect.stringContaining("'since'"));
});

test("infinite: off plans no infinite query and warns about none", () => {
  const ir = goldenIr("reference", "tasks");
  const outcome = planQueries(ir, clientOf(ir), { infinite: false });

  expect(outcome.status === "planned" && outcome.warnings).toEqual([]);
  expect(
    outcome.status === "planned" &&
      outcome.plan.operations.some((operation) => operation.names.infinite),
  ).toBe(false);
});

test("two operations whose generated names meet are refused by name, with both operation ids", () => {
  const ir = goldenIr("reference", "tasks");
  const outcome = planQueries(ir, clientOf(ir, { getTask: "listTasksInfinite" }), INFINITE_ON);

  expect(outcome.status === "refused" && outcome.refusals).toContainEqual(
    expect.objectContaining({
      code: "names.collision",
      operation: "listTasks",
      message: expect.stringContaining("the operation 'getTask'"),
    }),
  );
});

test("an operation the client leaves out is refused", () => {
  const ir = goldenIr("reference", "tasks");
  const client = clientOf(ir);
  const { getTask: _left, ...kept } = client.operations;

  expect(planQueries(ir, { ...client, operations: kept }, INFINITE_ON)).toMatchObject({
    status: "refused",
    refusals: [{ code: "link.client.operation.missing", operation: "getTask" }],
  });
});
