import { afterEach, expect, test } from "vitest";
import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS } from "../cli-io.js";
import { runCli } from "../run-cli.js";
import { makeApp, removeTemporaryDirectories } from "./fake-app.test-support.js";

afterEach(removeTemporaryDirectories);

async function explain(
  directory: string,
  operation: string,
): Promise<{ exitCode: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    cwd: directory,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  const exitCode = await runCli(["explain", operation], io);

  return { exitCode, out: out.join(""), err: err.join("") };
}

test("explain prints the reference updateTask with the derivation and the file and line of each fact", async () => {
  const app = makeApp("sources:\n  a: { path: ./a }\n", []);
  const explained = await explain(app, "tasks.updateTask");

  expect(explained.err).toBe("");
  expect(explained.exitCode).toBe(EXIT_SUCCESS);

  const lines = explained.out.split("\n");

  expect(lines).toContain(
    "operationId: updateTask                          # ops.update, tasks/api.yaml:51",
  );
  expect(lines).toContain("identity: user                                   # tasks/api.yaml:23");
  expect(lines).toContain(
    "csrf: X-Csrf-Token                               # csrf.cookieWrite, shared/base.yaml:23, shared/base.yaml:3",
  );
  expect(lines).toContain(
    "  - { right: tasks.update, subject: path.taskId }  # tasks/api.yaml:53; the subject defaults to the member id",
  );
  expect(lines).toContain(
    "  - { status: 409, code: state.conflict }        # concurrency.version, tasks/api.yaml:41",
  );
  expect(lines).toContain(
    "  - { status: 500, code: api.internal }          # response.undeclared, shared/base.yaml:98, tasks/api.yaml:51",
  );
});

test("explain names the api it needs and the operation it cannot find", async () => {
  const app = makeApp("sources:\n  a: { path: ./a }\n", []);
  const alone = await explain(app, "updateTask");

  expect(alone.exitCode).toBe(EXIT_REFUSED);
  expect(alone.err).toMatch(/^explain\.api\.needed: /);

  const unknown = await explain(app, "tasks.nope");

  expect(unknown.err).toMatch(
    /^explain\.operation\.unknown: The api 'tasks' has no operation 'nope'/,
  );
});

test("explain prints a scalar's format and lists the nested members it does not render", async () => {
  const app = makeApp("sources:\n  a: { path: ./a }\n", []);
  const explained = await explain(app, "tasks.updateTask");
  const lines = explained.out.split("\n");

  expect(lines.some((line) => line.includes("path.taskId: { type: uuid"))).toBe(true);

  const notShown = lines.find((line) => line.startsWith("# not shown yet:"));

  expect(notShown).toContain("errors.roles");
});
