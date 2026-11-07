import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS, EXIT_USAGE } from "../cli-io.js";
import { runCli } from "../run-cli.js";
import { makeApp, removeTemporaryDirectories } from "./fake-app.test-support.js";

afterEach(removeTemporaryDirectories);

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

const CONTRACT = ["--name", "@acme/tasks", "--version", "1.0.0"];

test("a bundle written as an npm package is consumed as a pinned package source, with the same IR", async () => {
  const app = makeApp("sources:\n  a: { path: ./a }\n", []);
  const bundled = await run(app, [
    "bundle",
    "--npm-package",
    "node_modules/@acme/tasks",
    ...CONTRACT,
  ]);

  expect(bundled.err).toBe("");
  expect(bundled.exitCode).toBe(EXIT_SUCCESS);

  const integrity = /^integrity: (sha256-\S+)$/m.exec(bundled.out)?.[1];

  expect(integrity).toBeDefined();

  writeFileSync(
    join(app, "seampact.config.yaml"),
    `sources:\n  b: { package: '@acme/tasks', version: 1.0.0, integrity: '${integrity}' }\ntargets:\n  - { id: server, use: fake-server, api: tasks }\n`,
  );

  const compiled = await run(app, ["compile", "--out", "ir"]);

  expect(compiled.err).toBe("");
  expect(compiled.exitCode).toBe(EXIT_SUCCESS);
  expect(readFileSync(join(app, "ir", "tasks.ir.json"), "utf8")).toBe(
    readFileSync(join(app, "node_modules", "@acme", "tasks", "ir", "tasks.json"), "utf8"),
  );
});

test("the tarball is the same bytes on a second run", async () => {
  const app = makeApp("sources:\n  a: { path: ./a }\n", []);

  await run(app, ["bundle", "--tarball", "one.tgz", ...CONTRACT]);
  await run(app, ["bundle", "--tarball", "two.tgz", ...CONTRACT]);

  expect(readFileSync(join(app, "one.tgz")).equals(readFileSync(join(app, "two.tgz")))).toBe(true);
});

test("bundle refuses a missing or a second output, and an unclear source, by name", async () => {
  const app = makeApp("sources:\n  a: { path: ./a }\n  b: { path: ./b }\n", [], ["a", "b"]);

  expect((await run(app, ["bundle", ...CONTRACT])).exitCode).toBe(EXIT_USAGE);
  expect((await run(app, ["bundle", "--out", "x", "--tarball", "y.tgz"])).exitCode).toBe(
    EXIT_USAGE,
  );

  const ambiguous = await run(app, ["bundle", "--out", "x", ...CONTRACT]);

  expect(ambiguous.exitCode).toBe(EXIT_REFUSED);
  expect(ambiguous.err).toMatch(/^bundle\.source\.ambiguous: /);

  const unknown = await run(app, ["bundle", "--out", "x", "--source", "c", ...CONTRACT]);

  expect(unknown.err).toMatch(/^bundle\.source\.unknown: /);
});

test("bundle prints the compile warnings of the source and still writes the bundle", async () => {
  const app = makeApp("sources:\n  a: { path: ./a }\n", []);
  const apiFile = join(app, "a", "tasks-service", "api.yaml");

  writeFileSync(
    apiFile,
    readFileSync(apiFile, "utf8").replace("prefix: /internal/v{version}", "prefix: ''"),
  );

  const bundled = await run(app, ["bundle", "--out", "out", ...CONTRACT]);

  expect(bundled.exitCode).toBe(EXIT_SUCCESS);
  expect(bundled.err).toMatch(/In source 'a'[\s\S]*warning/);
  expect(bundled.out).toMatch(/^integrity: sha256-/m);
});
