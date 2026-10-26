import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS, runCli } from "@seampact/cli";
import { afterEach, expect, test } from "vitest";
import { BINARY_NATIVE_ONLY_COMMANDS } from "./binary-refusals.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SPRING_BOOT_USE = "io.github.jubasse:seampact-spring-boot";
const DOCUMENT_DIRECTORY = "openapi";

const NATIVE_APP_CONFIG = `sources:
  contract: { path: ./contract }
targets:
  - { id: spring, use: '${SPRING_BOOT_USE}', apis: [tasks, tasksService] }
  - { id: laravel, use: seampact/laravel, api: tasks }
`;

// The same documents, listed by an app with no target: the Node CLI writes them.
const OPENAPI_ONLY_CONFIG = `sources:
  contract: { path: ./contract }
targets: []
openapi:
  tasks: { public: openapi/tasks.public.yaml, full: openapi/tasks.full.yaml }
  tasksService: openapi/tasksService.yaml
`;

const MIXED_APP_CONFIG = `sources:
  contract: { path: ./contract }
targets:
  - { id: spring, use: '${SPRING_BOOT_USE}', api: tasks }
  - { id: server, use: '@acme/server', api: tasks }
`;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function appWith(config: string): string {
  const directory = mkdtempSync(join(tmpdir(), "seampact-binary-"));

  temporaryDirectories.push(directory);
  cpSync(join(repositoryRoot, "fixtures/reference"), join(directory, "contract"), {
    recursive: true,
  });
  writeFileSync(join(directory, "seampact.config.yaml"), config);

  return directory;
}

interface CapturedIo extends CliIo {
  output: string[];
  errors: string[];
}

function capturingIo(cwd: string, host: "binary" | "node-cli"): CapturedIo {
  const output: string[] = [];
  const errors: string[] = [];

  return {
    cwd,
    output,
    errors,
    stdout: (text) => output.push(text),
    stderr: (text) => errors.push(text),
    ...(host === "binary" ? { nativeOnlyCommands: BINARY_NATIVE_ONLY_COMMANDS } : {}),
  };
}

function documentsOf(appDirectory: string): Record<string, string> {
  const directory = join(appDirectory, DOCUMENT_DIRECTORY);

  return Object.fromEntries(
    readdirSync(directory)
      .sort()
      .map((file) => [file, readFileSync(join(directory, file), "utf8")]),
  );
}

test("writes and checks a native app's documents as the Node CLI writes them", async () => {
  const nativeApp = appWith(NATIVE_APP_CONFIG);
  const generateIo = capturingIo(nativeApp, "binary");

  expect(await runCli(["generate"], generateIo)).toBe(EXIT_SUCCESS);
  expect(generateIo.output.join("")).toContain(`entry 'spring' uses '${SPRING_BOOT_USE}'`);
  expect(generateIo.output.join("")).toContain("entry 'laravel' uses 'seampact/laravel'");

  const checkIo = capturingIo(nativeApp, "binary");

  expect(await runCli(["check"], checkIo)).toBe(EXIT_SUCCESS);

  const openApiOnlyApp = appWith(OPENAPI_ONLY_CONFIG);

  expect(await runCli(["generate"], capturingIo(openApiOnlyApp, "node-cli"))).toBe(EXIT_SUCCESS);
  expect(Object.keys(documentsOf(nativeApp))).toEqual([
    ".seampact-manifest.json",
    "tasks.full.yaml",
    "tasks.public.yaml",
    "tasksService.yaml",
  ]);
  expect(documentsOf(nativeApp)).toEqual(documentsOf(openApiOnlyApp));
});

test.each([
  ["generate", "binary.generate-unavailable"],
  ["check", "binary.check-unavailable"],
])("refuses %s on an app config with an npm entry, naming it", async (command, code) => {
  const app = appWith(MIXED_APP_CONFIG);
  const io = capturingIo(app, "binary");

  expect(await runCli([command], io)).toBe(EXIT_REFUSED);

  const errors = io.errors.join("");

  expect(errors).toContain(`${code}: `);
  expect(errors).toContain("entry 'server'");
  expect(errors).not.toContain("entry 'spring'");
  expect(existsSync(join(app, DOCUMENT_DIRECTORY))).toBe(false);
});
