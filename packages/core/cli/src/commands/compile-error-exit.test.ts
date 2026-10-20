import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { type CliIo, EXIT_REFUSED } from "../cli-io.js";
import { runCli } from "../run-cli.js";
import {
  makeApp,
  removeTemporaryDirectories,
  trackTemporaryDirectory,
} from "./fake-app.test-support.js";

afterEach(removeTemporaryDirectories);

// An app whose one `path` source holds a contract the compiler reports an error on.
function makeBrokenContractApp(): string {
  const app = makeApp(
    "sources:\n  a: { path: ./a }\ntargets:\n  - { id: server, use: fake-server, api: tasks }\n",
    [{ name: "fake-server", role: "server", files: [{ path: "a.ts", contents: "export {};\n" }] }],
  );

  appendFileSync(join(app, "a", "tasks", "schemas.yaml"), "Broken: { type: nope }\n");

  return app;
}

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

test("generate exits non-zero when a contract has a compile error", async () => {
  const result = await run(makeBrokenContractApp(), ["generate"]);

  expect(result.err).toContain("nope");
  expect(result.exitCode).toBe(EXIT_REFUSED);
});

test("check exits non-zero and claims no match when a contract has a compile error", async () => {
  const result = await run(makeBrokenContractApp(), ["check"]);

  expect(result.err).toContain("nope");
  expect(result.out).not.toContain("match");
  expect(result.exitCode).toBe(EXIT_REFUSED);
});

test("lint exits non-zero when a contract has a compile error", async () => {
  const result = await run(makeBrokenContractApp(), ["lint"]);

  expect(result.exitCode).toBe(EXIT_REFUSED);
});

test("diff exits non-zero when a contract has a compile error", async () => {
  const app = makeBrokenContractApp();
  const baseline = mkdtempSync(join(tmpdir(), "seampact-cli-baseline-"));

  trackTemporaryDirectory(baseline);

  const result = await run(app, ["diff", "--against", baseline]);

  expect(result.exitCode).toBe(EXIT_REFUSED);
});
