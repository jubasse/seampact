import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localSourcePolicy } from "@seampact/compiler";
import { afterEach, expect, test } from "vitest";
import { removeConfigTrees, writeConfigTree } from "./config-test-tree.test-support.js";
import { readAppConfig } from "./read-app-config.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });

  removeConfigTrees();
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

test.each(["keep", "off"])("reads frameworkDocs: %s", async (value) => {
  const outcome = await readConfigText(`${SERVER_ENTRY_HEAD}    frameworkDocs: ${value}\n`);

  expect(outcome).toMatchObject({
    status: "read",
    config: { entries: [{ entry: { frameworkDocs: value } }] },
  });
});

test("refuses frameworkDocs: off beside nativeDocs: true, naming both", async () => {
  const outcome = await readConfigText(
    `${SERVER_ENTRY_HEAD}    frameworkDocs: off\n    artefacts: { nativeDocs: true }\n`,
  );

  expect(outcome).toMatchObject({
    status: "refused",
    problems: [
      {
        code: "config.key.conflict",
        message: expect.stringMatching(/frameworkDocs: off.*artefacts\.nativeDocs: true/),
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

test("reads every artefact switch, the boot check as a boolean, and allowUntested", async () => {
  const outcome = await readConfigText(
    `${SERVER_ENTRY_HEAD}    artefacts: { types: false, nativeDocs: true, bootCheck: false }\n    allowUntested: [express@6]\nchecks: { matrix: error }\n`,
  );

  expect(outcome).toMatchObject({
    status: "read",
    config: {
      checks: { matrix: "error" },
      entries: [
        {
          entry: {
            artefacts: { types: false, nativeDocs: true, bootCheck: false },
            allowUntested: ["express@6"],
          },
        },
      ],
    },
  });
});

test("refuses an allow-list beside the whole boot check switched off", async () => {
  const outcome = await readConfigText(
    `${SERVER_ENTRY_HEAD}    artefacts: { bootCheck: false }\n    frameworkRoutes:\n      - { path: /metrics, reason: r }\n`,
  );

  expect(outcome).toMatchObject({
    status: "refused",
    problems: [
      {
        code: "config.key.conflict",
        message: expect.stringContaining("with 'artefacts.bootCheck: false'"),
      },
    ],
  });
});

test.each([
  ["an artefact switch that is no boolean", "artefacts: { types: off }", "must be boolean"],
  ["a boot check of another form", "artefacts: { bootCheck: on }", "'bootCheck' is true, false"],
  ["an allowUntested item without its major", "allowUntested: [express]", "must match pattern"],
])("refuses %s", async (_, key, message) => {
  const outcome = await readConfigText(`${SERVER_ENTRY_HEAD}    ${key}\n`);

  expect(outcome).toMatchObject({
    status: "refused",
    problems: [{ code: "config.schema", message: expect.stringContaining(message) }],
  });
});

test("refuses a package source that is not an npm package name", async () => {
  const outcome = await readConfigText(
    "sources:\n  contracts: { package: ../../x, version: 1.0.0 }\ntargets:\n  - { id: t, use: x, api: a }\n",
  );

  const scoped = await readConfigText(
    "sources:\n  contracts: { package: '@acme/tasks.contract', version: 1.0.0 }\ntargets:\n  - { id: t, use: x, api: a }\n",
  );

  expect(outcome).toMatchObject({ status: "refused" });
  expect(JSON.stringify(outcome)).toContain("sources.contracts");
  expect(scoped).toMatchObject({ status: "read" });
});

const ROOT_FILES = {
  "seampact.config.yaml":
    "apps: [apps/api]\nallowLocal: false\nsources:\n  shared: { path: ./contracts }\n",
  "apps/api/seampact.config.yaml":
    "sources:\n  own: { path: ./contracts }\ntargets:\n  - { id: types, use: x, api: shared/tasks }\n",
};

function readTreeApp(directory: string, app = "apps/api") {
  return readAppConfig(join(directory, app, "seampact.config.yaml"), `${app}/seampact.config.yaml`);
}

test("folds a listed app's root in: its sources resolved against the root, its allowLocal under the app's", async () => {
  const directory = writeConfigTree(ROOT_FILES);
  const outcome = await readTreeApp(directory);

  expect(outcome).toMatchObject({
    status: "read",
    config: {
      allowLocal: false,
      rootFile: join(directory, "seampact.config.yaml"),
      sources: new Map([
        ["shared", { kind: "path", directory: join(directory, "contracts") }],
        ["own", { kind: "path", directory: join(directory, "apps/api/contracts") }],
      ]),
    },
  });

  const appAllowing = writeConfigTree({
    ...ROOT_FILES,
    "apps/api/seampact.config.yaml": "allowLocal: true\n",
  });
  const allowing = await readTreeApp(appAllowing);

  expect(allowing).toMatchObject({ status: "read", config: { allowLocal: true } });

  const allowLocal = allowing.status === "read" ? allowing.config.allowLocal : undefined;

  expect(localSourcePolicy(allowLocal, {})).toBe("allow");
  expect(localSourcePolicy(allowLocal, { SEAMPACT_ALLOW_LOCAL: "false" })).toBe("refuse");
});

test("refuses a source name defined in both the app and its root, naming both files", async () => {
  const directory = writeConfigTree({
    ...ROOT_FILES,
    "apps/api/seampact.config.yaml": "sources:\n  shared: { path: ./mine }\n",
  });

  expect(await readTreeApp(directory)).toEqual({
    status: "refused",
    problems: [
      {
        code: "config.source.duplicate",
        message:
          "The source 'shared' is defined both in this app config and in its root config seampact.config.yaml.",
        fix: "Remove the app's definition to use the root's source, or rename one of them.",
        where: "apps/api/seampact.config.yaml:2:3 sources.shared",
      },
    ],
  });
});

test("leaves an app the nearest root does not list alone, and names the root for a source only it defines", async () => {
  const directory = writeConfigTree({
    ...ROOT_FILES,
    "apps/web/seampact.config.yaml": "sources:\n  own: { path: ./c }\n",
    "apps/other/seampact.config.yaml": ROOT_FILES["apps/api/seampact.config.yaml"],
  });

  expect(await readTreeApp(directory, "apps/web")).toMatchObject({
    status: "read",
    config: {
      sources: new Map([["own", { kind: "path", directory: join(directory, "apps/web/c") }]]),
    },
  });
  expect(await readTreeApp(directory, "apps/other")).toMatchObject({
    status: "refused",
    problems: [
      {
        code: "config.app.unlisted",
        message: expect.stringContaining(
          "'shared/tasks' names a source of the root config seampact.config.yaml",
        ),
        where: "apps/other/seampact.config.yaml:4:5 targets[0]",
      },
    ],
  });
});

test("walks past a nearer root that does not list the app to the root that does", async () => {
  const directory = writeConfigTree({
    ...ROOT_FILES,
    "apps/seampact.config.yaml": "apps: [other]\n",
    "apps/other/seampact.config.yaml": "sources:\n  own: { path: ./c }\n",
  });

  expect(await readTreeApp(directory)).toMatchObject({
    status: "read",
    config: {
      rootFile: join(directory, "seampact.config.yaml"),
      sources: new Map([
        ["own", { kind: "path", directory: join(directory, "apps/api/contracts") }],
        ["shared", { kind: "path", directory: join(directory, "contracts") }],
      ]),
    },
  });
});

test("refuses an app below an ancestor config with a YAML error, naming that file", async () => {
  const directory = writeConfigTree({ ...ROOT_FILES, "apps/seampact.config.yaml": "targets: [\n" });

  expect(await readTreeApp(directory)).toMatchObject({
    status: "refused",
    problems: [
      { code: "config.yaml.syntax", where: expect.stringContaining("apps/seampact.config.yaml") },
    ],
  });
});

test("stops the search for a root at the first directory holding .git", async () => {
  const directory = writeConfigTree({ ...ROOT_FILES, "apps/.git/HEAD": "ref: refs/heads/main\n" });

  expect(await readTreeApp(directory)).toMatchObject({
    status: "read",
    config: {
      sources: new Map([
        ["own", { kind: "path", directory: join(directory, "apps/api/contracts") }],
      ]),
    },
  });
});

test("reads the app's openapi key and an empty checks key", async () => {
  const outcome = await readConfigText(
    "openapi:\n  tasks: { public: openapi/public.yaml, full: { path: openapi/full.yaml, reasons: omit } }\nchecks: {}\n",
  );

  expect(outcome).toMatchObject({
    status: "read",
    config: {
      openapi: {
        tasks: {
          public: "openapi/public.yaml",
          full: { path: "openapi/full.yaml", reasons: "omit" },
        },
      },
    },
  });
});

test("refuses an api's documents that are neither a path, a placed document nor a document mapping", async () => {
  const outcome = await readConfigText("openapi:\n  tasks: [openapi/tasks.yaml]\n");

  expect(outcome).toMatchObject({
    status: "refused",
    problems: [
      { code: "config.schema", message: expect.stringContaining("An api's documents are a path") },
    ],
  });
});

test.each([
  ["a mount", `${SERVER_ENTRY_HEAD}    mount: /api\n`, "'mount'"],
  ["native access", `${SERVER_ENTRY_HEAD}    access: { native: "Spring Security." }\n`, "'access'"],
  [
    "the boot check's handler switch",
    `${SERVER_ENTRY_HEAD}    artefacts: { bootCheck: { handlers: false } }\n`,
    "'handlers'",
  ],
  [
    "a native target",
    "targets:\n  - { id: server, use: 'com.acme:server', api: a }\n",
    "native target",
  ],
  [
    "a module link",
    `${SERVER_ENTRY_HEAD}    link: { validators: { module: x } }\n`,
    "explicit module specifier",
  ],
])("refuses by name %s until its bringer reads it", async (_, text, named) => {
  expect(await readConfigText(text)).toMatchObject({
    status: "refused",
    problems: [{ code: "config.key.waits", message: expect.stringContaining(named) }],
  });
});

test("names the app to run in when an app-level command is run on a root config", async () => {
  expect(
    await readConfigText("apps: [api]\nopenapi: { all: { path: all.yaml, apps: [api] } }\n"),
  ).toEqual({
    status: "refused",
    problems: [
      {
        code: "config.root.not-an-app",
        message:
          "This file is a monorepo root config (it holds `apps`), and the command runs on one app's config.",
        fix: "Run the command in one of the apps the root config lists, or pass that app's config with `--config`.",
        where: "seampact.config.yaml:1:1 apps",
      },
    ],
  });
});

test("reads the checks and diff settings of an app", async () => {
  expect(
    await readConfigText(
      "checks: { openapi: warning, generated: disabled }\ndiff: { gate: both }\n",
    ),
  ).toMatchObject({
    status: "read",
    config: { checks: { openapi: "warning", generated: "disabled" }, diff: { gate: "both" } },
  });
});
