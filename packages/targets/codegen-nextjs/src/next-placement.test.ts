import { join } from "node:path";
import {
  GENERATE_TIMEOUT_MILLISECONDS,
  projectDirectory,
} from "@seampact/codegen-core/node-server/test-support";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { nextGenerateRequest, REFERENCE_API } from "./generate-request.test-support.js";

// Calls the route handler the reference project generates for the `tasks` api with Web `Request`s, as Next.js does
// from the catch-all `route.ts`, without Next.js: the placement's answers no type check sees.

const PROJECT = projectDirectory(import.meta.url, "next-placement");
// The scenario every Node server target's test app shares: handlers, hooks and the record of their calls.
const SCENARIO_SOURCE = new URL(
  "../../../core/codegen-core/test-app/reference-scenario.js",
  import.meta.url,
).href;
const ORIGIN = "http://localhost";

interface ReferenceScenario {
  readonly calls: { readonly unexpected: unknown[] };
  readonly handlers: object;
  readonly hooks: object;
  resetScenario(): void;
}

type RouteHandler = (request: Request) => Promise<Response>;

interface GeneratedNextModule {
  routeHandler(options: object): RouteHandler;
}

let scenario: ReferenceScenario;
let generated: GeneratedNextModule;

beforeAll(async () => {
  await nextGenerateRequest(PROJECT);
  scenario = await import(SCENARIO_SOURCE);
  generated = await import(join(PROJECT, "generated", "server", REFERENCE_API, "index.ts"));
}, GENERATE_TIMEOUT_MILLISECONDS);

beforeEach(() => {
  scenario.resetScenario();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function routeHandlerWith(extraOptions: object = {}): RouteHandler {
  return generated.routeHandler({
    handlers: scenario.handlers,
    hooks: scenario.hooks,
    ...extraOptions,
  });
}

describe("the client address", () => {
  test("a throwing clientAddress answers the api's 500 and reaches onUnexpectedError", async () => {
    const handler = routeHandlerWith({
      clientAddress: () => {
        throw new Error("client address read");
      },
    });

    const response = await handler(new Request(`${ORIGIN}/v1/health`));

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("json");
    expect(scenario.calls.unexpected).toHaveLength(1);
  });
});

describe("a path the catch-all receives", () => {
  test("an encoded base path off the mount answers the 404, with no log and no onUnexpectedError", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = routeHandlerWith();

    const response = await handler(new Request(`${ORIGIN}/%761/health`));

    expect(response.status).toBe(404);
    expect(error).not.toHaveBeenCalled();
    expect(scenario.calls.unexpected).toEqual([]);
  });

  test("a path under no base path, even decoded, still answers the mount mismatch 500", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = routeHandlerWith();

    const response = await handler(new Request(`${ORIGIN}/v2/health`));

    expect(response.status).toBe(500);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("set the entry's 'mount'"));
  });
});
