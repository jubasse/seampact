import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS } from "../cli-io.js";
import { runCli } from "../run-cli.js";
import {
  makeApp,
  REFERENCE_WORKSPACE,
  removeTemporaryDirectories,
  trackTemporaryDirectory,
} from "./fake-app.test-support.js";

afterEach(removeTemporaryDirectories);

const GENERATED_FILE = { path: "a.ts", contents: "export const a = 1;\n" };

async function run(
  directory: string,
  args: string[],
): Promise<{ exitCode: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    cwd: directory,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  const exitCode = await runCli(args, io);

  return { exitCode, out: out.join(""), err: err.join("") };
}

const SERVER_APP_CONFIG =
  "sources:\n  a: { path: ./a }\ntargets:\n  - { id: server, use: fake-server, api: tasks }\n";

function makeServerApp(extraConfig = ""): string {
  return makeApp(`${extraConfig}${SERVER_APP_CONFIG}`, [
    { name: "fake-server", role: "server", files: [GENERATED_FILE] },
  ]);
}

test("check passes after generate and names a hand-edited generated file", async () => {
  const app = makeServerApp();

  expect((await run(app, ["generate"])).exitCode).toBe(EXIT_SUCCESS);
  expect(await run(app, ["check"])).toMatchObject({ exitCode: EXIT_SUCCESS });

  const file = join(app, "__generated__/server/a.ts");

  writeFileSync(file, "export const a = 2;\n");

  const edited = await run(app, ["check"]);

  expect(edited.exitCode).toBe(EXIT_REFUSED);
  expect(edited.err).toContain("check.generated.drift");
  expect(edited.err).toContain(file);
});

test("check names a missing generated file, before and after a generate", async () => {
  const app = makeServerApp();

  const missing = await run(app, ["check"]);

  expect(missing.exitCode).toBe(EXIT_REFUSED);
  expect(missing.err).toContain("a.ts (missing)");

  await run(app, ["generate"]);
  rmSync(join(app, "__generated__/server/a.ts"));

  expect((await run(app, ["check"])).err).toContain("a.ts (missing)");
});

test("checks.generated warning reports the drift and passes, disabled does not look", async () => {
  const warning = makeServerApp("checks: { generated: warning }\nopenapi: none\n");

  const reported = await run(warning, ["check"]);

  expect(reported.exitCode).toBe(EXIT_SUCCESS);
  expect(reported.err).toContain("warning: check.generated.drift");

  const disabled = makeServerApp("checks: { generated: disabled }\nopenapi: none\n");
  const skipped = await run(disabled, ["check"]);

  expect(skipped.exitCode).toBe(EXIT_SUCCESS);
  expect(skipped.err).not.toContain("check.generated.drift");
});

test("check names an edited OpenAPI document and the line it differs at", async () => {
  const app = makeServerApp();

  await run(app, ["generate"]);

  const document = join(app, "openapi/tasks.full.yaml");

  writeFileSync(document, `${readFileSync(document, "utf8")}extra: 1\n`);

  const edited = await run(app, ["check"]);

  expect(edited.exitCode).toBe(EXIT_REFUSED);
  expect(edited.err).toContain("check.openapi.drift");
  expect(edited.err).toContain("tasks.full.yaml");
});

test("check writes nothing", async () => {
  const app = makeServerApp();

  await run(app, ["check"]);

  expect(existsSync(join(app, "__generated__"))).toBe(false);
  expect(existsSync(join(app, "openapi"))).toBe(false);
});

const ROOT_CONFIG = "apps: [apps/api]\nopenapi:\n  all: { path: all.yaml }\n";

// A root holding one app (a server target on the reference workspace) and a merged document.
function makeRoot(rootExtra = ""): string {
  const app = makeApp(
    "sources:\n  a: { path: ../../a }\ntargets:\n  - { id: server, use: fake-server, api: tasks }\n",
    [{ name: "fake-server", role: "server", files: [GENERATED_FILE] }],
    [],
  );
  const root = join(app, "root");
  const appDirectory = join(root, "apps/api");

  mkdirSync(appDirectory, { recursive: true });
  mkdirSync(join(root, ".git"));
  cpSync(join(app, "seampact.config.yaml"), join(appDirectory, "seampact.config.yaml"));
  cpSync(join(app, "node_modules"), join(appDirectory, "node_modules"), { recursive: true });
  cpSync(REFERENCE_WORKSPACE, join(root, "a"), { recursive: true });
  writeFileSync(join(root, "seampact.config.yaml"), `${ROOT_CONFIG}${rootExtra}`);
  trackTemporaryDirectory(root);

  return root;
}

test("generate and check on a root config run each app, then write and check the merged documents", async () => {
  const root = makeRoot();
  const generated = await run(root, ["generate"]);

  expect(generated.exitCode).toBe(EXIT_SUCCESS);
  expect(generated.out).toContain("app 'apps/api', entry 'server'");
  expect(existsSync(join(root, "all.yaml"))).toBe(true);
  expect(existsSync(join(root, "apps/api/__generated__/server/a.ts"))).toBe(true);
  expect(await run(root, ["check"])).toMatchObject({ exitCode: EXIT_SUCCESS });

  writeFileSync(
    join(root, "all.yaml"),
    `${readFileSync(join(root, "all.yaml"), "utf8")}extra: 1\n`,
  );

  const edited = await run(root, ["check"]);

  expect(edited.exitCode).toBe(EXIT_REFUSED);
  expect(edited.err).toContain("check.openapi.drift");
  expect(edited.err).toContain("all.yaml");
});

test("checks.openapi of the root governs the merged documents", async () => {
  const root = makeRoot("checks: { openapi: warning }\n");

  await run(root, ["generate"]);
  writeFileSync(
    join(root, "all.yaml"),
    `${readFileSync(join(root, "all.yaml"), "utf8")}extra: 1\n`,
  );

  const edited = await run(root, ["check"]);

  expect(edited.exitCode).toBe(EXIT_SUCCESS);
  expect(edited.err).toContain("warning: check.openapi.drift");
});

test("an app command run on a root config is refused naming the fix", async () => {
  const root = makeRoot();
  const refused = await run(root, ["compile"]);

  expect(refused.exitCode).toBe(EXIT_REFUSED);
  expect(refused.err).toContain("config.root.not-an-app");
});

test("compile reads only the source holding an api named alone", async () => {
  const app = makeApp(
    "sources:\n  a: { path: ./a }\n  b: { path: ./b }\ntargets:\n  - { id: types, use: fake-types, api: tasks }\n",
    [{ name: "fake-types" }],
    ["a", "b"],
  );

  writeFileSync(
    join(app, "b/workspace.yaml"),
    readFileSync(join(app, "b/workspace.yaml"), "utf8").replace(/^ {4}tasks: .*\n/m, ""),
  );

  const compiled = await run(app, ["compile"]);

  expect(compiled.exitCode).toBe(EXIT_SUCCESS);
  expect(compiled.out).toContain("Compiled 2 api(s)");
});

test("lint runs the core rules over each path source", async () => {
  const app = makeServerApp();
  const linted = await run(app, ["lint"]);

  expect(linted.err).not.toContain("error");
  expect(linted.out).toContain("Linted 2 api(s)");
  expect(linted.exitCode).toBe(EXIT_SUCCESS);
});

test("diff compares the current contract with the IRs compile wrote", async () => {
  const app = makeServerApp();

  await run(app, ["compile", "--out", "baseline"]);

  const same = await run(app, ["diff", "--against", "baseline"]);

  expect(same.exitCode).toBe(EXIT_SUCCESS);
  expect(same.out).toContain("no change");

  const missing = await run(app, ["diff", "--against", "nowhere"]);

  expect(missing.exitCode).toBe(EXIT_REFUSED);
  expect(missing.err).toContain("diff.against.invalid");
  expect((await run(app, ["diff"])).err).toContain("cli.usage");
});
