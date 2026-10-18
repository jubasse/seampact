import { join } from "node:path";
import {
  copyTestApp,
  emitProject,
  generateReferenceProject,
  projectDirectory,
  type ReferenceIrChange,
  sendRawRequest,
} from "@seampact/codegen-core/node-server/test-support";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { target as fastifyTarget } from "./index.js";

// Boots the Fastify test app on a probe contract where one GET path is static next to a param path of the same
// form (`/v1/me/drafts/preferences` and `/v1/me/drafts/{draftId}`): Fastify decodes a percent-encoded static
// segment, so it can route a request to another operation than the raw path names.

const PROJECT = projectDirectory(import.meta.url, "route-mismatch");
const BUILD = join(PROJECT, "build");
const APP_SOURCE = new URL("../test-app/reference-app.js", import.meta.url);
const SETUP_TIMEOUT_MILLISECONDS = 60_000;

const USER = "55555555-5555-4555-8555-555555555555";
const BEARER = { authorization: `Bearer user-${USER}` };
const STATIC_DRAFTS_PATH = "/v1/me/drafts/preferences";
const UNBOUNDED_PARAMS_WARNING = "declare no maxLength";

const preferencesUnderDrafts: ReferenceIrChange = (ir, api) =>
  api !== "tasks"
    ? ir
    : {
        ...ir,
        operations: ir.operations.map((operation) =>
          operation.id === "getPreferences" ? { ...operation, path: STATIC_DRAFTS_PATH } : operation,
        ),
      };

interface ProbeAppModule {
  readonly calls: { readonly handled: string[] };
  resetScenario(): void;
  startReferenceApp(): Promise<{ host: string; port: number; close(): Promise<void> }>;
}

let app: ProbeAppModule;
let server: Awaited<ReturnType<ProbeAppModule["startReferenceApp"]>>;
let bootWarnings: string[] = [];

beforeAll(async () => {
  const files = await generateReferenceProject(
    PROJECT,
    fastifyTarget,
    { bodyValidation: true },
    preferencesUnderDrafts,
  );

  expect(emitProject(PROJECT, files, BUILD)).toEqual([]);
  app = await import(copyTestApp(BUILD, APP_SOURCE));

  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  server = await app.startReferenceApp();
  bootWarnings = warn.mock.calls.map((call) => String(call[0]));
  warn.mockRestore();
}, SETUP_TIMEOUT_MILLISECONDS);

beforeEach(() => {
  app.resetScenario();
});

afterAll(async () => {
  await server?.close();
});

describe("a request Fastify routes to another operation than its raw path", () => {
  test("an encoded static segment answers the path's 404 and runs no handler", async () => {
    const reply = await sendRawRequest(server, "GET", "/v1/me/drafts/%70references", {
      headers: BEARER,
    });

    expect(reply.status).toBe(404);
    expect(app.calls.handled).toEqual([]);
  });

  test("the same static segment sent as is reaches its own operation", async () => {
    const reply = await sendRawRequest(server, "GET", STATIC_DRAFTS_PATH, { headers: BEARER });

    expect(reply.status).not.toBe(404);
    expect(app.calls.handled).toEqual(["getPreferences"]);
  });
});

describe("the boot check on path params", () => {
  test("uuid path params count as bounded, so the reference boots without the unbounded warning", () => {
    expect(bootWarnings.filter((warning) => warning.includes(UNBOUNDED_PARAMS_WARNING))).toEqual(
      [],
    );
  });
});
