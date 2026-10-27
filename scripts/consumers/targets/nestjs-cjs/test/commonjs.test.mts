// The `server-cjs` tree of this consumer is CommonJS (`generated/server-cjs/package.json`), as in a NestJS app on
// CommonJS: its modules require the CommonJS build of `@seampact/server-runtime`, an app boots and serves on it, and
// the consumer's typecheck reads that build's types.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const CONSUMER_ROOT = fileURLToPath(new URL("..", import.meta.url));
const COMMONJS_PLACEMENT = /server-runtime[\\/]dist[\\/]cjs[\\/]nestjs\.js$/;
// Spawning tsx and loading NestJS outruns vitest's default 5 s test limit.
const SPAWN_TIMEOUT_MILLISECONDS = 60_000;

// Requires the api's CommonJS tree under tsx's CommonJS loader; answers its module class name and the modules it required.
const REQUIRED_MODULES_SCRIPT = [
  'require("reflect-metadata");',
  'const tasks = require("./generated/server-cjs/tasks/index.ts");',
  "process.stdout.write(JSON.stringify({",
  "  moduleClassName: tasks.SeampactModule.name,",
  "  requiredModules: Object.keys(require.cache),",
  "}));",
].join("\n");

test("the CommonJS tree requires the runtime's CommonJS build and names its module class", {
  timeout: SPAWN_TIMEOUT_MILLISECONDS,
}, () => {
  const run = spawnSync(process.execPath, ["--import", "tsx", "-e", REQUIRED_MODULES_SCRIPT], {
    cwd: CONSUMER_ROOT,
    encoding: "utf8",
  });

  expect(run.stderr).toBe("");
  expect(run.status).toBe(0);

  expect(JSON.parse(run.stdout)).toEqual({
    moduleClassName: "TasksSeampactModule",
    requiredModules: expect.arrayContaining([expect.stringMatching(COMMONJS_PLACEMENT)]),
  });
});

test("a NestJS app on the CommonJS tree boots and serves an operation", {
  timeout: SPAWN_TIMEOUT_MILLISECONDS,
}, () => {
  const run = spawnSync(process.execPath, ["--import", "tsx", "test/boot-commonjs.cts"], {
    cwd: CONSUMER_ROOT,
    encoding: "utf8",
  });

  expect(run.stderr).toBe("");
  expect(run.status).toBe(0);
  expect(JSON.parse(run.stdout)).toEqual({ status: 200, body: { status: "ok" } });
});
