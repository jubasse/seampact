import { operationLocation, planOperation, type Refusal } from "@seampact/codegen-core";
import { readGoldenIr } from "@seampact/codegen-core/node-server/test-support";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { type MockPlan, operationMocks } from "../runtime/mock-runtime.js";
import { mockPathOf } from "./mock-path.js";
import { type MockPlan as GeneratedMockPlan, mockPlanOf } from "./mock-plan.js";

const CONFIG = { baseUrl: "http://api.test" };
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

interface TaskOutput {
  status: 200;
  body: unknown;
}

const MOCK_METHODS = ["get", "post", "put", "patch", "delete"] as const;

function payloadPlan(
  operation: string,
  contractPath: string,
  extra: Partial<MockPlan> = {},
): MockPlan {
  return {
    operation,
    member: operation,
    method: "get",
    route: contractPath,
    path: mockPathOf(contractPath),
    shadowedBy: [],
    successes: [{ status: 200, shape: "payload", media: "application/json", payload: [] }],
    format: "bare",
    errors: {},
    ...extra,
  };
}

function runtimePlanOf(plan: GeneratedMockPlan): MockPlan {
  const method = MOCK_METHODS.find((known) => known === plan.method);

  if (method === undefined) throw new Error(`the plan's method '${plan.method}' is not an MSW one`);

  return { ...plan, method };
}

test("literal path text is escaped, so each handler answers its own URL and no other", async () => {
  expect(mockPathOf("/v1/channels/{channelId}/tasks:batch")).toBe(
    "/v1/channels/:channelId/tasks\\:batch",
  );

  for (const contractPath of ["/v1/tasks:batch", "/v1/tasks/(all)", "/v1/tasks/purge+all"]) {
    server.use(
      operationMocks<TaskOutput, never>(CONFIG, payloadPlan("own", contractPath), {}).reply(
        200,
        contractPath,
      ),
    );

    const answer = await fetch(`http://api.test${contractPath}`);

    expect([answer.status, await answer.json()]).toEqual([200, contractPath]);
  }

  const sibling = await fetch("http://api.test/v1/tasks:search").catch((error: unknown) => error);

  expect(sibling instanceof Error).toBe(true);
});

test("an override of a template route passes a request for its more specific sibling through", async () => {
  const search = operationMocks<TaskOutput, never>(
    CONFIG,
    payloadPlan("searchTasks", "/v1/tasks/search", {
      example: { name: "found", status: 200, value: "search answer" },
    }),
    {},
  );
  const getTask = operationMocks<TaskOutput, never>(
    CONFIG,
    payloadPlan("getTask", "/v1/tasks/{taskId}", { shadowedBy: [mockPathOf("/v1/tasks/search")] }),
    {},
  );

  server.use(search.handler);
  server.use(getTask.reply(200, "override"));

  const searched = await fetch("http://api.test/v1/tasks/search");
  const read = await fetch("http://api.test/v1/tasks/t1");

  expect([await searched.json(), await read.json()]).toEqual(["search answer", "override"]);
});

test("a paged operation's example, its item array, is answered inside the page body", async () => {
  const ir = readGoldenIr("tasks");
  const index = ir.operations.findIndex((operation) => operation.id === "listTasks");
  const listTasks = ir.operations[index];

  if (listTasks === undefined) throw new Error("the reference contract has no listTasks");

  const items = [{ taskId: "t1", title: "Write" }];
  const operation = {
    ...listTasks,
    examples: { firstPage: { status: 200, value: items } },
  };
  const location = operationLocation(index, operation.id);
  const refusals: Refusal[] = [];
  const planned = planOperation(operation, ir, location, refusals);
  const plan = mockPlanOf(operation, "listTasks", planned, ir, location, refusals);

  expect(refusals).toEqual([]);

  server.use(operationMocks<TaskOutput, never>(CONFIG, runtimePlanOf(plan), {}).handler);

  const answer = await fetch("http://api.test/v1/channels/c1/tasks");

  // The reference contract writes a page bare: the body is the item array.
  expect([answer.status, await answer.json()]).toEqual([200, items]);
});

test("a retry header in seconds rounds the milliseconds param up, as the server runtime writes it", async () => {
  const rateLimited = {
    status: 429,
    media: "application/problem+json",
    body: { code: "api.rate_limited" },
    mergeParams: true,
    noStore: true,
  };
  const plan = payloadPlan("getTask", "/v1/tasks/{taskId}", {
    errors: {
      "api.rate_limited": {
        retryHeader: { name: "Retry-After", param: "retryAfterMs", unit: "s" },
      },
    },
  });
  const mocks = operationMocks<
    TaskOutput,
    { status: 429; code: "api.rate_limited"; params: { retryAfterMs: number } }
  >(CONFIG, plan, { bare: { "api.rate_limited": rateLimited } });

  server.use(mocks.error("api.rate_limited", { retryAfterMs: 1500 }));

  const answer = await fetch("http://api.test/v1/tasks/t1");

  expect([
    answer.status,
    answer.headers.get("retry-after"),
    answer.headers.get("cache-control"),
  ]).toEqual([429, "2", "no-store"]);
});
