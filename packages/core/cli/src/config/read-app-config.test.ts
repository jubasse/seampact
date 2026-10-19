import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { readAppConfig } from "./read-app-config.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function readConfigText(text: string) {
  const directory = mkdtempSync(join(tmpdir(), "seampact-cli-"));

  temporaryDirectories.push(directory);

  const file = join(directory, "seampact.config.yaml");

  writeFileSync(file, text);

  return readAppConfig(file, "seampact.config.yaml");
}

test("refuses a reserved key written directly or as a YAML alias", async () => {
  const direct = await readConfigText(
    "sources:\n  contracts: { path: ./c }\ntargets:\n  - { id: t, use: x, api: a, options: { __proto__: { polluted: true } } }\n",
  );
  const aliased = await readConfigText(
    "sources:\n  contracts: { path: ./c }\ntargets:\n  - id: t\n    use: x\n    api: a\n    options: { name: &k __proto__, ? *k : { polluted: true } }\n",
  );

  for (const outcome of [direct, aliased]) {
    expect(outcome).toMatchObject({
      status: "refused",
      problems: [{ code: "config.key.reserved", message: expect.stringContaining("'__proto__'") }],
    });
  }
});

const SERVER_ENTRY_HEAD = "targets:\n  - id: server\n    use: x\n    api: a\n";

test("reads the framework-route allow-list of a target entry", async () => {
  const outcome = await readConfigText(
    `${SERVER_ENTRY_HEAD}    frameworkRoutes:\n      - { method: GET, path: /metrics, reason: "Scraped by Prometheus." }\n      - { path: '/admin/queues/**', reason: "The queue dashboard's own routes." }\n`,
  );

  expect(outcome).toMatchObject({
    status: "read",
    config: {
      entries: [
        {
          entry: {
            frameworkRoutes: [
              { method: "GET", path: "/metrics", reason: "Scraped by Prometheus." },
              { path: "/admin/queues/**", reason: "The queue dashboard's own routes." },
            ],
          },
        },
      ],
    },
  });
});

test("reads the framework-route check switched off", async () => {
  const outcome = await readConfigText(
    `${SERVER_ENTRY_HEAD}    artefacts: { bootCheck: { frameworkRoutes: false } }\n`,
  );

  expect(outcome).toMatchObject({
    status: "read",
    config: { entries: [{ entry: { artefacts: { bootCheck: { frameworkRoutes: false } } } }] },
  });
});

test("refuses an allow-list beside the framework-route check switched off", async () => {
  const outcome = await readConfigText(
    `${SERVER_ENTRY_HEAD}    artefacts: { bootCheck: { frameworkRoutes: false } }\n    frameworkRoutes:\n      - { path: /metrics, reason: r }\n`,
  );

  expect(outcome).toMatchObject({
    status: "refused",
    problems: [
      {
        code: "config.key.conflict",
        message: expect.stringContaining("'server' allow-lists framework routes"),
      },
    ],
  });
});

test.each([
  ["no reason", "{ path: /metrics }", "The key 'reason' is required here."],
  [
    "an empty reason",
    '{ path: /metrics, reason: "" }',
    "The value must NOT have fewer than 1 characters.",
  ],
  ["a star inside a segment", "{ path: '/metrics*', reason: r }", "The value must match pattern"],
  ["a relative path", "{ path: metrics, reason: r }", "The value must match pattern"],
  [
    "an unknown method",
    "{ method: get, path: /metrics, reason: r }",
    "The value must be equal to one of the allowed values.",
  ],
])("refuses a framework route with %s", async (_, route, message) => {
  const outcome = await readConfigText(
    `${SERVER_ENTRY_HEAD}    frameworkRoutes:\n      - ${route}\n`,
  );

  expect(outcome).toMatchObject({
    status: "refused",
    problems: [{ code: "config.schema", message: expect.stringContaining(message) }],
  });
});

test("refuses by name the artefact switches that wait, beside the read boot check switch", async () => {
  const outcome = await readConfigText(
    `${SERVER_ENTRY_HEAD}    artefacts: { types: false, bootCheck: { handlers: false, frameworkRoutes: false } }\n`,
  );

  expect(outcome).toMatchObject({
    status: "refused",
    problems: [
      { code: "config.key.waits", message: expect.stringContaining("'types'") },
      { code: "config.key.waits", message: expect.stringContaining("'handlers'") },
    ],
  });
  expect(outcome.status === "refused" ? outcome.problems : []).toHaveLength(2);
});
