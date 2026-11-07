import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS } from "../cli-io.js";
import { runCli } from "../run-cli.js";
import {
  installReferenceBundle,
  makeApp,
  REFERENCE_BUNDLE,
  removeTemporaryDirectories,
} from "./fake-app.test-support.js";

afterEach(removeTemporaryDirectories);

async function run(directory: string, args: string[]) {
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

// An app whose `tasks` api has a schema no operation reaches; `severity` is the rule's
// level in the contract's `lint.rules`, or none for the rule's default (a warning).
function makeAppWithUnusedSchema(severity?: string): string {
  const app = makeApp(
    "sources:\n  a: { path: ./a }\ntargets:\n  - { id: server, use: fake-server, api: tasks }\n",
    [{ name: "fake-server", role: "server", files: [{ path: "a.ts", contents: "export {};\n" }] }],
  );
  const apiFile = join(app, "a", "tasks", "api.yaml");

  writeFileSync(
    join(app, "a", "tasks", "schemas.yaml"),
    `${readFileSync(join(app, "a", "tasks", "schemas.yaml"), "utf8")}Orphan:\n  type: object\n  properties:\n    note: { type: string }\n`,
  );

  if (severity !== undefined) {
    writeFileSync(
      apiFile,
      `${readFileSync(apiFile, "utf8")}\nlint:\n  rules: { seampact/unused-declaration: ${severity} }\n`,
    );
  }

  return app;
}

test("lint exits 1 and names the source, api and rule when a rule is set to error", async () => {
  const result = await run(makeAppWithUnusedSchema("error"), ["lint"]);

  expect(result.exitCode).toBe(EXIT_REFUSED);
  expect(result.err).toContain("In source 'a', api 'tasks':");
  expect(result.err).toContain("seampact/unused-declaration");
  expect(result.out).toMatch(/Linted \d+ api\(s\): [1-9]\d* error\(s\)/);
});

test("lint exits 0 and counts the warning when a rule keeps its warning default", async () => {
  const result = await run(makeAppWithUnusedSchema(), ["lint"]);

  expect(result.exitCode).toBe(EXIT_SUCCESS);
  expect(result.err).toContain("seampact/unused-declaration");
  expect(result.out).toMatch(/0 error\(s\), [1-9]\d* warning\(s\)/);
});

test("lint exits 0 and prints nothing about a rule the contract disables", async () => {
  const result = await run(makeAppWithUnusedSchema("disabled"), ["lint"]);

  expect(result.exitCode).toBe(EXIT_SUCCESS);
  expect(result.err).not.toContain("seampact/unused-declaration");
});

test("lint refuses with lint.no-source when the app config has only a bundle source", async () => {
  const app = makeApp("", [], []);
  const integrity = installReferenceBundle(app);

  writeFileSync(
    join(app, "seampact.config.yaml"),
    `sources:\n  contract: { package: '${REFERENCE_BUNDLE.name}', version: ${REFERENCE_BUNDLE.version}, integrity: '${integrity}' }\ntargets: []\n`,
  );

  const result = await run(app, ["lint"]);

  expect(result.exitCode).toBe(EXIT_REFUSED);
  expect(result.err).toContain("lint.no-source");
});
