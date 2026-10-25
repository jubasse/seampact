import { readGoldenIr } from "@seampact/codegen-core/node-server/test-support";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, expect, test } from "vitest";
import { type MockPlan, operationMocks } from "../runtime/mock-runtime.js";
import { defaultExampleOf, mockPathOf } from "./mock-plan.js";

const CONFIG = { baseUrl: "http://api.test/" };
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

const NOT_FOUND = {
  status: 404,
  media: "application/problem+json",
  body: { code: "api.not_found", status: 404 },
  mergeParams: true,
  noStore: false,
} as const;

const WRITINGS = { bare: { "api.not_found": NOT_FOUND } };

interface TaskOutput {
  status: 200;
  body: unknown;
}

interface TaskErrors {
  status: 404;
  code: "api.not_found";
  params: { resource: string };
}

function mocksOf(example?: MockPlan["example"]) {
  return operationMocks<TaskOutput, TaskErrors>(CONFIG, taskPlan(example), WRITINGS);
}

function taskPlan(example?: MockPlan["example"]): MockPlan {
  return {
    operation: "getTask",
    member: "getTask",
    method: "get",
    path: mockPathOf("/v1/channels/{channelId}/tasks/{taskId}"),
    successes: [{ status: 200, shape: "payload", media: "application/json", payload: ["data"] }],
    format: "bare",
    errors: { "api.not_found": {} },
    ...(example === undefined ? {} : { example }),
  };
}

test("a contract path becomes an MSW path whose params the resolver reads", async () => {
  expect(mockPathOf("/v1/channels/{channelId}/tasks/{taskId}")).toBe(
    "/v1/channels/:channelId/tasks/:taskId",
  );

  const mocks = mocksOf();

  server.use(
    mocks.resolve(({ params }) => ({
      status: 200,
      body: { channel: params.channelId, task: params.taskId },
    })),
  );

  const answer = await fetch("http://api.test/v1/channels/c1/tasks/t1?view=full");

  expect(await answer.json()).toEqual({ data: { channel: "c1", task: "t1" } });
  expect(
    (await fetch("http://api.test/v1/channels/c1/tasks/t1/archive").catch(
      (error: unknown) => error,
    )) instanceof Error,
  ).toBe(true);
});

test("the default handler answers the operation's first success example, wrapped in the format", async () => {
  server.use(mocksOf({ name: "open", status: 200, value: { title: "Write" } }).handler);

  const answer = await fetch("http://api.test/v1/channels/c1/tasks/t1");

  expect([answer.status, await answer.json()]).toEqual([200, { data: { title: "Write" } }]);
});

test("without an example the default handler fails naming the operation and how to give it a reply", async () => {
  server.use(mocksOf().handler);

  const answer = await fetch("http://api.test/v1/channels/c1/tasks/t1");
  const body: unknown = await answer.json();

  expect(answer.status).toBe(500);
  expect(body).toMatchObject({
    name: "MissingMockReply",
    message: expect.stringContaining(
      "'getTask' (GET /v1/channels/:channelId/tasks/:taskId) has no example",
    ),
  });
});

test("an error answer writes the format's body with the params merged in, under the code's status", async () => {
  server.use(mocksOf().error("api.not_found", { resource: "task" }));

  const answer = await fetch("http://api.test/v1/channels/c1/tasks/t1");

  expect([answer.status, answer.headers.get("content-type"), await answer.json()]).toEqual([
    404,
    "application/problem+json",
    { code: "api.not_found", status: 404, resource: "task" },
  ]);
});

test("the example rule takes a success example only, never a request or an error example", () => {
  const ir = readGoldenIr("tasks");
  const searchTasks = ir.operations.find((operation) => operation.id === "searchTasks");

  if (searchTasks === undefined) throw new Error("the reference contract has no searchTasks");

  expect(defaultExampleOf(searchTasks)?.name).toBe("firstPage");
  expect(
    defaultExampleOf({
      ...searchTasks,
      examples: {
        asked: { request: true, value: {} },
        refused: { error: "api.not_found", value: {} },
      },
    }),
  ).toBeUndefined();
});
