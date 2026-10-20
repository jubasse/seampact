import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parse } from "yaml";
import { EXIT_REFUSED, EXIT_SUCCESS } from "../cli-io.js";
import { type FakeTarget, generateOutput, makeApp } from "./fake-app.test-support.js";

const BOUNDARY = { id: "boundary", defaultOn: true };
const NATIVE_DOCS = { id: "nativeDocs", defaultOn: false, needs: ["boundary"] };

const NATIVE_TARGET: FakeTarget = {
  name: "fake-server",
  role: "server",
  artefacts: [BOUNDARY, NATIVE_DOCS],
  echoNativeDocsDocument: true,
  frameworkDocsOffFix: "Remove the `SwaggerModule.setup` call.",
};

function serverApp(entry: string, target: FakeTarget = NATIVE_TARGET): string {
  return makeApp(
    `sources:\n  a: { path: ./a }\ntargets:\n  - { id: server, use: fake-server, ${entry} }\n`,
    [target],
  );
}

function nativeDocument(app: string): { name?: string; document: { paths: object } } {
  return JSON.parse(readFileSync(join(app, "__generated__/server/native-document.json"), "utf8"));
}

function writtenDocument(app: string, file: string): unknown {
  return parse(readFileSync(join(app, file), "utf8"));
}

test("native docs document follows the entry", async () => {
  const publicApp = serverApp("api: tasks, document: public, artefacts: { nativeDocs: true }");

  expect((await generateOutput(publicApp)).exitCode).toBe(EXIT_SUCCESS);
  expect(nativeDocument(publicApp).name).toBe("public");
  expect(nativeDocument(publicApp).document).toEqual(
    writtenDocument(publicApp, "openapi/tasks.public.yaml"),
  );

  const wholeApp = serverApp("api: tasks, artefacts: { nativeDocs: true }");

  expect((await generateOutput(wholeApp)).exitCode).toBe(EXIT_SUCCESS);
  expect(nativeDocument(wholeApp).name).toBe("full");
  expect(nativeDocument(wholeApp).document).toEqual(
    writtenDocument(wholeApp, "openapi/tasks.full.yaml"),
  );

  const undocumentedApp = serverApp("api: tasksService, artefacts: { nativeDocs: true }");

  expect((await generateOutput(undocumentedApp)).exitCode).toBe(EXIT_SUCCESS);
  expect(nativeDocument(undocumentedApp).name).toBeUndefined();
  expect(nativeDocument(undocumentedApp).document).toEqual(
    writtenDocument(undocumentedApp, "openapi/tasksService.yaml"),
  );
});

test("native docs document is refused as ambiguous when two documents hold every route", async () => {
  const app = serverApp(
    "api: tasks, operations: { include: [health] }, artefacts: { nativeDocs: true }",
  );
  const { exitCode, output } = await generateOutput(app);

  expect(exitCode).toBe(EXIT_REFUSED);
  expect(output).toContain("nativeDocs.document.ambiguous");
  expect(output).toContain("'full', 'public' each hold every route");
  expect(output).toContain("Set `document` on the entry");
});

test("nativeDocs is off by default and needs the boundary", async () => {
  const off = serverApp("api: tasks");

  expect((await generateOutput(off)).exitCode).toBe(EXIT_SUCCESS);
  expect(existsSync(join(off, "__generated__/server/native-document.json"))).toBe(false);

  const withoutBoundary = serverApp("api: tasks, artefacts: { nativeDocs: true, boundary: false }");
  const { exitCode, output } = await generateOutput(withoutBoundary);

  expect(exitCode).toBe(EXIT_REFUSED);
  expect(output).toContain("config.artefacts.needed");
  expect(output).toContain("'nativeDocs'");
});

test("nativeDocs on a target that declares none points at the generated openapi file", async () => {
  const app = serverApp("api: tasks, artefacts: { nativeDocs: true }", {
    name: "fake-server",
    role: "server",
    artefacts: [BOUNDARY],
  });
  const { exitCode, output } = await generateOutput(app);

  expect(exitCode).toBe(EXIT_REFUSED);
  expect(output).toContain("config.artefacts.unknown");
  expect(output).toContain("openapi/<api>.yaml");
});

test("frameworkDocs off is refused with each target's fix", async () => {
  const withFix = serverApp("api: tasks, frameworkDocs: off");
  const withFixResult = await generateOutput(withFix);

  expect(withFixResult.exitCode).toBe(EXIT_REFUSED);
  expect(withFixResult.output).toContain("config.frameworkDocs.unsupported");
  expect(withFixResult.output).toContain("Fix: Remove the `SwaggerModule.setup` call.");

  const withoutFix = serverApp("api: tasks, frameworkDocs: off", {
    name: "fake-server",
    role: "server",
    artefacts: [BOUNDARY],
  });
  const withoutFixResult = await generateOutput(withoutFix);

  expect(withoutFixResult.exitCode).toBe(EXIT_REFUSED);
  expect(withoutFixResult.output).toContain("writes no switch for its framework's own document");

  const keep = serverApp("api: tasks, frameworkDocs: keep");

  expect((await generateOutput(keep)).exitCode).toBe(EXIT_SUCCESS);

  const conflict = serverApp("api: tasks, frameworkDocs: off, artefacts: { nativeDocs: true }");
  const conflictResult = await generateOutput(conflict);

  expect(conflictResult.exitCode).toBe(EXIT_REFUSED);
  expect(conflictResult.output).toContain("config.key.conflict");
  expect(conflictResult.output).toContain("frameworkDocs: off");
  expect(conflictResult.output).toContain("artefacts.nativeDocs: true");
});

test("frameworkDocs is refused on a target that is no server", async () => {
  const app = serverApp("api: tasks, frameworkDocs: keep", { name: "fake-server" });
  const { exitCode, output } = await generateOutput(app);

  expect(exitCode).toBe(EXIT_REFUSED);
  expect(output).toContain("config.key.unsupported");
  expect(output).toContain("'frameworkDocs'");
});
