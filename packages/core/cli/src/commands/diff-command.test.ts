import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS } from "../cli-io.js";
import { runCli } from "../run-cli.js";
import { makeApp, removeTemporaryDirectories } from "./fake-app.test-support.js";

afterEach(removeTemporaryDirectories);

async function run(directory: string, args: string[], today?: string) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    cwd: directory,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    ...(today === undefined ? {} : { today: () => today }),
  };
  const exitCode = await runCli(args, io);

  return { exitCode, out: out.join(""), err: err.join("") };
}

async function appWithBaseline(
  diffConfig: string,
  prepare: (app: string) => void = () => undefined,
): Promise<string> {
  const app = makeApp(
    `${diffConfig}sources:\n  a: { path: ./a }\ntargets:\n  - { id: server, use: fake-server, api: tasks }\n`,
    [{ name: "fake-server", role: "server", files: [{ path: "a.ts", contents: "export {};\n" }] }],
  );

  prepare(app);
  await run(app, ["compile", "--out", "baseline"]);

  return app;
}

// A required member added to a request body: every existing client now sends an invalid request.
function breakClients(app: string): void {
  const file = join(app, "a", "tasks", "schemas.yaml");

  writeFileSync(
    file,
    readFileSync(file, "utf8").replace(
      "  required: [reason]\n  properties:\n    reason:",
      "  required: [reason, note]\n  properties:\n    note: { type: string }\n    reason:",
    ),
  );
}

test("diff exits 1 and reports the change when a client request becomes invalid", async () => {
  const app = await appWithBaseline("");

  breakClients(app);

  const result = await run(app, ["diff", "--against", "baseline"]);

  expect(result.exitCode).toBe(EXIT_REFUSED);
  expect(result.out).toContain("property.added");
  expect(result.out).toContain("gate failed");
});

test("diff exits 0 for a change the gate does not fail", async () => {
  const app = await appWithBaseline("");
  const file = join(app, "a", "tasks", "schemas.yaml");

  writeFileSync(
    file,
    `${readFileSync(file, "utf8")}Extra: { type: object, properties: { a: { type: string } } }\n`,
  );

  const result = await run(app, ["diff", "--against", "baseline"]);

  expect(result.exitCode).toBe(EXIT_SUCCESS);
  expect(result.out).not.toContain("gate failed");
});

// Gates the api whose `legacy` operation is deprecated: the others declare no compatibility policy.
function gateResponsesApi(app: string): void {
  const file = join(app, "a", "tasks-responses", "api.yaml");

  writeFileSync(
    file,
    readFileSync(file, "utf8").replace(
      "  maturity: provisional\n",
      "  maturity: provisional\n  compat: { policy: additive-only }\n",
    ),
  );
}

// Removes the `legacy` operation, deprecated with a sunset on 2027-06-30: breaking for clients.
function removeSunsetOperation(app: string): void {
  const file = join(app, "a", "tasks-responses", "api.yaml");

  writeFileSync(file, readFileSync(file, "utf8").replace(/\n {12}legacy:\n(?: {14}.*\n)+/, "\n"));
}

test("diff exits 0 for the removal of an operation whose sunset has passed", async () => {
  const app = await appWithBaseline("", gateResponsesApi);

  removeSunsetOperation(app);

  const result = await run(app, ["diff", "--against", "baseline"], "2027-07-01");

  expect(result.exitCode).toBe(EXIT_SUCCESS);
  expect(result.out).toContain("gate passed");
});

test("diff exits 1 for the removal of an operation before its sunset", async () => {
  const app = await appWithBaseline("", gateResponsesApi);

  removeSunsetOperation(app);

  const result = await run(app, ["diff", "--against", "baseline"], "2027-06-29");

  expect(result.exitCode).toBe(EXIT_REFUSED);
  expect(result.out).toContain("gate failed");
});

test("diff exits 1 for the removal of an operation past its sunset once diff.exempt drops that exemption", async () => {
  const app = await appWithBaseline("diff: { exempt: [] }\n", gateResponsesApi);

  removeSunsetOperation(app);

  const result = await run(app, ["diff", "--against", "baseline"], "2027-07-01");

  expect(result.exitCode).toBe(EXIT_REFUSED);
});

test("diff refuses with diff.no-api when the app config names no api", async () => {
  const app = makeApp("sources:\n  a: { path: ./a }\ntargets: []\n", []);

  const result = await run(app, ["diff", "--against", "baseline"]);

  expect(result.exitCode).toBe(EXIT_REFUSED);
  expect(result.err).toContain("diff.no-api");
});
