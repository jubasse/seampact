import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { type CliIo, EXIT_REFUSED } from "../cli-io.js";
import { runCli } from "../run-cli.js";

const MISSING_PACKAGE = "@acme/codegen-absent";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function capturingIo(cwd: string): CliIo & { errors: string[] } {
  const errors: string[] = [];

  return { cwd, errors, stdout: () => {}, stderr: (text) => errors.push(text) };
}

test("names the package and the install command when a target is missing", async () => {
  const appDirectory = mkdtempSync(join(tmpdir(), "seampact-cli-"));

  temporaryDirectories.push(appDirectory);
  writeFileSync(join(appDirectory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(
    join(appDirectory, "seampact.config.yaml"),
    `sources:\n  contracts: { path: ./contracts }\ntargets:\n  - { id: types, use: '${MISSING_PACKAGE}', api: tasks }\n`,
  );

  const io = capturingIo(appDirectory);
  const exitCode = await runCli(["generate"], io);
  const output = io.errors.join("");

  expect(exitCode).toBe(EXIT_REFUSED);
  expect(output).toContain("config.target.missing");
  expect(output).toContain(`'${MISSING_PACKAGE}'`);
  expect(output).toContain(`pnpm add -D ${MISSING_PACKAGE}`);
  expect(existsSync(join(appDirectory, "__generated__"))).toBe(false);
});

test("leaves a native target to its build plugin", async () => {
  const appDirectory = mkdtempSync(join(tmpdir(), "seampact-cli-"));

  temporaryDirectories.push(appDirectory);
  writeFileSync(
    join(appDirectory, "seampact.config.yaml"),
    "sources:\n  contracts: { path: ./contracts }\ntargets:\n  - { id: server, use: 'com.acme:server', api: tasks }\n",
  );

  const io = capturingIo(appDirectory);
  const exitCode = await runCli(["generate"], io);
  const output = io.errors.join("");

  expect(exitCode).toBe(EXIT_REFUSED);
  expect(output).toContain("config.target.native");
  expect(output).toContain("'com.acme:server'");
});
