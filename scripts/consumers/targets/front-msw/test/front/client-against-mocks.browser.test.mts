// The cases in the browser: the generated handlers under `setupWorker`, answering the fetch client on the page's
// own origin through MSW's service worker.
import { setupWorker } from "msw/browser";
import { afterAll, afterEach, beforeAll } from "vitest";
import { createMocks } from "../../generated/mocks/tasks/index.js";
import { describeClientAgainstMocks } from "../msw/client-against-mocks.mjs";

const baseUrl = window.location.origin;
const mocks = createMocks({ baseUrl });
const worker = setupWorker(...mocks.handlers);

beforeAll(async () => {
  await worker.start({ quiet: true, onUnhandledRequest: "bypass" });
});
afterEach(() => worker.resetHandlers());
afterAll(() => worker.stop());

describeClientAgainstMocks(() => ({
  mocks,
  baseUrl,
  use: (...handlers) => worker.use(...handlers),
}));
