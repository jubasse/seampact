import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { EXIT_REFUSED, EXIT_SUCCESS } from "../cli-io.js";
import {
  generateErrors,
  generateOutput,
  installReferenceBundle,
  makeApp,
  REFERENCE_BUNDLE,
  removeTemporaryDirectories,
  trackTemporaryDirectory,
} from "./fake-app.test-support.js";

afterEach(removeTemporaryDirectories);

test("refuses two apis items of one entry that resolve to the same api name", async () => {
  const app = makeApp(
    "sources:\n  a: { path: ./a }\n  b: { path: ./b }\ntargets:\n  - { id: both, use: fake-types, apis: [a/tasks, b/tasks] }\n",
    [{ name: "fake-types" }],
    ["a", "b"],
  );
  const { exitCode, output } = await generateErrors(app);

  expect(exitCode).toBe(EXIT_REFUSED);
  expect(output).toContain("config.api.duplicate");
  expect(output).toContain("'a/tasks'");
  expect(output).toContain("'b/tasks'");
});

test("refuses a link of a kind the consumer does not consume", async () => {
  const app = makeApp(
    "sources:\n  a: { path: ./a }\ntargets:\n  - { id: types, use: fake-types, api: tasks, link: { validators: zod } }\n  - { id: zod, use: fake-zod, api: tasks }\n",
    [{ name: "fake-types" }, { name: "fake-zod", provides: ["validators"] }],
  );
  const { exitCode, output } = await generateErrors(app);

  expect(exitCode).toBe(EXIT_REFUSED);
  expect(output).toContain("link.kind.not-consumed");
  expect(output).toContain("'types'");
  expect(output).toContain("'zod'");
});

test("gives a diagnostic for an ESM-only target and for a malformed package.json", async () => {
  const esmOnly = makeApp(
    "sources:\n  a: { path: ./a }\ntargets:\n  - { id: types, use: fake-esm, api: tasks }\n",
    [
      {
        name: "fake-esm",
        packageJson: JSON.stringify({
          name: "fake-esm",
          exports: { ".": { import: "./index.mjs" } },
        }),
      },
    ],
  );
  const esmResult = await generateErrors(esmOnly);

  expect(esmResult.exitCode).toBe(EXIT_REFUSED);
  expect(esmResult.output).toContain("config.target.unresolvable");
  expect(esmResult.output).toContain("`require` or `default`");

  const malformedTarget = makeApp(
    "sources:\n  a: { path: ./a }\ntargets:\n  - { id: types, use: fake-broken, api: tasks }\n",
    [{ name: "fake-broken", packageJson: "{ not json" }],
  );
  const targetResult = await generateErrors(malformedTarget);

  expect(targetResult.exitCode).toBe(EXIT_REFUSED);
  expect(targetResult.output).toContain("config.target.unresolvable");

  const malformedApp = makeApp(
    "sources:\n  a: { path: ./a }\ntargets:\n  - { id: types, use: fake-absent, api: tasks }\n",
    [],
  );

  writeFileSync(join(malformedApp, "package.json"), "{ not json");

  const appResult = await generateErrors(malformedApp);

  expect(appResult.exitCode).toBe(EXIT_REFUSED);
  expect(appResult.output).toContain("config.target.unresolvable");
  expect(appResult.output).toContain("package.json");
});

test("prints a target's warnings and still writes its files", async () => {
  const app = makeApp(
    "sources:\n  a: { path: ./a }\ntargets:\n  - { id: server, use: fake-server, api: tasks }\n",
    [
      {
        name: "fake-server",
        warnings: [
          {
            code: "owner.handler",
            message: "The caller ownership is not enforced by the generated boundary.",
            fix: "Scope the handler's reads and writes to the authenticated principal.",
            operation: "getDraft",
          },
        ],
      },
    ],
  );
  const { exitCode, output } = await generateErrors(app);

  expect(exitCode).toBe(EXIT_SUCCESS);
  expect(output).toBe(
    "warning: owner.handler: entry 'server', api 'tasks': The caller ownership is not enforced by the generated boundary. (operation 'getDraft') Fix: Scope the handler's reads and writes to the authenticated principal.\n",
  );
});

test("writes the documents an OpenAPI-only app lists, with no target package installed", async () => {
  const app = makeApp(
    "sources:\n  a: { path: ./a }\nopenapi:\n  tasksService: { path: docs/service.yaml, extensions: none }\n",
    [],
  );
  const first = await generateOutput(app);
  const document = readFileSync(join(app, "docs/service.yaml"), "utf8");

  expect(first).toEqual({
    exitCode: EXIT_SUCCESS,
    output: `openapi document 'tasksService': written (${join(app, "docs/service.yaml")}).\n`,
  });
  expect(document).toMatch(/^openapi: 3\.1\.0\n/);
  expect(document).not.toContain("x-seampact-");

  const second = await generateOutput(app);

  expect(second.output).toContain("'tasksService': unchanged");
});

test("writes each document of the api a server target serves by default, and none for a client target", async () => {
  const app = makeApp(
    "sources:\n  a: { path: ./a }\ntargets:\n  - { id: server, use: fake-server, api: tasks }\n  - { id: client, use: fake-client, api: tasksService }\n",
    [{ name: "fake-server", role: "server" }, { name: "fake-client" }],
  );
  const { exitCode } = await generateOutput(app);

  expect(exitCode).toBe(EXIT_SUCCESS);
  expect(existsSync(join(app, "openapi/tasks.public.yaml"))).toBe(true);
  expect(existsSync(join(app, "openapi/tasks.full.yaml"))).toBe(true);
  expect(existsSync(join(app, "openapi/tasksService.yaml"))).toBe(false);
});

test("refuses to replace a document seampact did not write, and writes nothing", async () => {
  const app = makeApp(
    "sources:\n  a: { path: ./a }\ntargets:\n  - { id: server, use: fake-server, api: tasks }\n",
    [{ name: "fake-server", role: "server" }],
  );
  const handWritten = "openapi: 3.1.0\ninfo: { title: exported by the framework }\n";

  mkdirSync(join(app, "openapi"));
  writeFileSync(join(app, "openapi/tasks.full.yaml"), handWritten);

  const { exitCode, output } = await generateOutput(app);

  expect(exitCode).toBe(EXIT_REFUSED);
  expect(output).toContain("openapi.document.not-generated");
  expect(output).toContain(join(app, "openapi/tasks.full.yaml"));
  expect(output).toContain("`openapi: none`");
  expect(readFileSync(join(app, "openapi/tasks.full.yaml"), "utf8")).toBe(handWritten);
  expect(existsSync(join(app, "openapi/tasks.public.yaml"))).toBe(false);
  expect(existsSync(join(app, "__generated__/server"))).toBe(false);
});

test("removes a document it wrote once the config drops it", async () => {
  const app = makeApp(
    "sources:\n  a: { path: ./a }\ntargets:\n  - { id: server, use: fake-server, api: tasks }\n",
    [{ name: "fake-server", role: "server" }],
  );

  expect((await generateOutput(app)).exitCode).toBe(EXIT_SUCCESS);
  expect(existsSync(join(app, "openapi/tasks.full.yaml"))).toBe(true);

  writeFileSync(
    join(app, "seampact.config.yaml"),
    "sources:\n  a: { path: ./a }\ntargets:\n  - { id: server, use: fake-server, api: tasks }\nopenapi: none\n",
  );

  const { exitCode, output } = await generateOutput(app);

  expect(exitCode).toBe(EXIT_SUCCESS);
  expect(output).toContain("removed");
  expect(existsSync(join(app, "openapi/tasks.full.yaml"))).toBe(false);
  expect(existsSync(join(app, "openapi/tasks.public.yaml"))).toBe(false);
});

test("does not resolve a root path source the app never uses under allowLocal: false", async () => {
  const root = mkdtempSync(join(tmpdir(), "seampact-cli-"));
  const app = join(root, "apps/api");

  trackTemporaryDirectory(root);
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "devonly"));
  mkdirSync(app, { recursive: true });
  writeFileSync(
    join(root, "devonly/workspace.yaml"),
    "workspace:\n  apis:\n    drafts: ./drafts.yaml\n",
  );
  writeFileSync(
    join(root, "seampact.config.yaml"),
    "apps: [apps/api]\nsources:\n  devonly: { path: ./devonly }\n",
  );

  const integrity = installReferenceBundle(app);

  writeFileSync(
    join(app, "seampact.config.yaml"),
    `allowLocal: false\nsources:\n  contract: { package: '${REFERENCE_BUNDLE.name}', version: ${REFERENCE_BUNDLE.version}, integrity: '${integrity}' }\nopenapi:\n  tasksService: docs/service.yaml\n`,
  );

  const { exitCode, output } = await generateOutput(app);

  expect(output).not.toContain("config.source.local");
  expect(exitCode).toBe(EXIT_SUCCESS);
  expect(existsSync(join(app, "docs/service.yaml"))).toBe(true);
});

test("writes the default documents with the operations the server entries serve", async () => {
  const app = makeApp(
    "sources:\n  a: { path: ./a }\ntargets:\n  - { id: server, use: fake-server, api: tasks, operations: { include: [listTasks] } }\n  - { id: other, use: fake-server, api: tasks, operations: { include: [getChannel] } }\n",
    [{ name: "fake-server", role: "server" }],
  );

  expect((await generateOutput(app)).exitCode).toBe(EXIT_SUCCESS);

  const document = readFileSync(join(app, "openapi/tasks.full.yaml"), "utf8");

  expect(document.match(/operationId: \w+/g)?.sort()).toEqual([
    "operationId: getChannel",
    "operationId: listTasks",
  ]);
});
