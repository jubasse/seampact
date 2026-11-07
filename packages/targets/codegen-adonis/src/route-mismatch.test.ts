import { join } from "node:path";
import {
  copyTestApp,
  emitProject,
  projectDirectory,
  type ReferenceIrChange,
  sendRawRequest,
} from "@seampact/codegen-core/node-server/test-support";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { type AdonisMajor, generateAdonisProject } from "./adonis-major.test-support.js";

// Boots the AdonisJS test app on a probe contract where one GET path is static next to a param path of the same
// form (`/v1/me/drafts/preferences` and `/v1/me/drafts/{draftId}`): a router that decodes a percent-encoded static
// segment can route a request to another operation than the raw path names.

const APP_SOURCE = new URL("../test-app/reference-app.js", import.meta.url);
const MAJORS: readonly AdonisMajor[] = [7, 6];
const SETUP_TIMEOUT_MILLISECONDS = 60_000;

const USER = "55555555-5555-4555-8555-555555555555";
const BEARER = { authorization: `Bearer user-${USER}` };
const STATIC_DRAFTS_PATH = "/v1/me/drafts/preferences";

const preferencesUnderDrafts: ReferenceIrChange = (ir, api) =>
  api !== "tasks"
    ? ir
    : {
        ...ir,
        operations: ir.operations.map((operation) =>
          operation.id === "getPreferences"
            ? { ...operation, path: STATIC_DRAFTS_PATH }
            : operation,
        ),
      };

interface ProbeAppModule {
  readonly calls: { readonly handled: string[] };
  resetScenario(): void;
  startReferenceApp(
    major: AdonisMajor,
  ): Promise<{ host: string; port: number; close(): Promise<void> }>;
}

describe.each(MAJORS)("AdonisJS %i", (major) => {
  const project = projectDirectory(import.meta.url, `route-mismatch-${major}`);
  let app: ProbeAppModule;
  let server: Awaited<ReturnType<ProbeAppModule["startReferenceApp"]>>;

  beforeAll(async () => {
    const files = await generateAdonisProject(
      project,
      major,
      { bodyValidation: true },
      preferencesUnderDrafts,
    );
    const build = join(project, "build");

    expect(emitProject(project, files, build)).toEqual([]);
    app = await import(copyTestApp(build, APP_SOURCE));
    server = await app.startReferenceApp(major);
  }, SETUP_TIMEOUT_MILLISECONDS);

  beforeEach(() => {
    app.resetScenario();
  });

  afterAll(async () => {
    await server?.close();
  });

  test("an encoded static segment never runs another operation's controller", async () => {
    const reply = await sendRawRequest(server, "GET", "/v1/me/drafts/%70references", {
      headers: BEARER,
    });

    // AdonisJS 7 decodes the segment and routes it to the static operation (the path's 404); AdonisJS 6 routes it to
    // the param operation, whose step 6 refuses the draft id.
    expect(reply.status).toBe(major === 7 ? 404 : 400);
    expect(app.calls.handled).toEqual([]);
  });

  test("the static segment sent as is reaches its own operation", async () => {
    const reply = await sendRawRequest(server, "GET", STATIC_DRAFTS_PATH, { headers: BEARER });

    expect(reply.status).not.toBe(404);
    expect(app.calls.handled).toEqual(["getPreferences"]);
  });
});
