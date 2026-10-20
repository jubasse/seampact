import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS } from "../cli-io.js";
import { runCli } from "../run-cli.js";

const REFERENCE_WORKSPACE = new URL("../../../../../fixtures/reference", import.meta.url).pathname;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

interface FakeTarget {
  name: string;
  consumes?: string[];
  provides?: string[];
  packageJson?: string;
  // What the fake's `generate` returns as `warnings`.
  warnings?: object[];
}

// A target package of plain CommonJS: the refusals below happen before `generate` is called.
function writeTargetPackage(appDirectory: string, target: FakeTarget): void {
  const directory = join(appDirectory, "node_modules", target.name);
  const kinds = (names: string[] = []) =>
    JSON.stringify(Object.fromEntries(names.map((kind) => [kind, { styles: [], style: "x" }])));

  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    target.packageJson ?? JSON.stringify({ name: target.name, main: "index.cjs" }),
  );
  writeFileSync(
    join(directory, "index.cjs"),
    `exports.target = {
  metadata: {
    packageName: ${JSON.stringify(target.name)},
    packageVersion: "0.0.0",
    role: "client",
    irSupport: {},
    artefacts: [],
    consumes: ${kinds(target.consumes)},
    provides: ${kinds(target.provides)},
  },
  parseOptions: (raw) => ({ status: "parsed", options: raw }),
  generate: async () => ({ status: "generated", files: [], warnings: ${JSON.stringify(target.warnings ?? [])} }),
  describe: () => ({ status: "described", descriptors: {} }),
};\n`,
  );
}

function makeApp(config: string, targets: FakeTarget[], sourceNames: string[] = ["a"]): string {
  const appDirectory = mkdtempSync(join(tmpdir(), "seampact-cli-"));

  temporaryDirectories.push(appDirectory);

  for (const name of sourceNames)
    cpSync(REFERENCE_WORKSPACE, join(appDirectory, name), { recursive: true });

  for (const target of targets) writeTargetPackage(appDirectory, target);

  writeFileSync(join(appDirectory, "seampact.config.yaml"), config);

  return appDirectory;
}

async function generateErrors(appDirectory: string): Promise<{ exitCode: number; output: string }> {
  const errors: string[] = [];
  const io: CliIo = { cwd: appDirectory, stdout: () => {}, stderr: (text) => errors.push(text) };
  const exitCode = await runCli(["generate"], io);

  return { exitCode, output: errors.join("") };
}

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
