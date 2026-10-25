// The cases in Node: the generated handlers under `setupServer`, answering the fetch client on an absolute base URL.
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";
import { createMocks } from "../../generated/mocks/tasks/index.js";
import { describeClientAgainstMocks } from "./client-against-mocks.mjs";

const BASE_URL = "http://api.test";
const mocks = createMocks({ baseUrl: BASE_URL });
const server = setupServer(...mocks.handlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describeClientAgainstMocks(() => ({
  mocks,
  baseUrl: BASE_URL,
  use: (...handlers) => server.use(...handlers),
}));
