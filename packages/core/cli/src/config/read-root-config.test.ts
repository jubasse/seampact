import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { removeConfigTrees, writeConfigTree } from "./config-test-tree.test-support.js";
import { readRootConfig } from "./read-root-config.js";
import { readWorkspaceConfigs } from "./read-workspace-configs.js";

afterEach(removeConfigTrees);

const APP_CONFIG = "sources:\n  own: { path: ./contracts }\n";

async function readRoot(root: string, apps: Record<string, string> = {}) {
  const directory = writeConfigTree({ "seampact.config.yaml": root, ...apps });

  return {
    directory,
    outcome: await readRootConfig(join(directory, "seampact.config.yaml"), "seampact.config.yaml"),
  };
}

test("reads the apps, the shared sources and the merged documents, defaulting a document's apps to every app", async () => {
  const { directory, outcome } = await readRoot(
    "apps: [apps/api, services/billing]\nallowLocal: false\nsources:\n  shared: { path: ./contracts }\nopenapi:\n  platform: { path: openapi/platform.yaml, prefix: { billing: billing }, extensions: none }\n  api: { path: openapi/api.yaml, apps: [apps/api] }\nchecks: { openapi: warning }\n",
    {
      "apps/api/seampact.config.yaml": APP_CONFIG,
      "services/billing/seampact.config.yaml": APP_CONFIG,
    },
  );

  expect(outcome).toEqual({
    status: "read",
    config: {
      file: join(directory, "seampact.config.yaml"),
      displayName: "seampact.config.yaml",
      apps: [
        {
          name: "apps/api",
          directory: join(directory, "apps/api"),
          file: join(directory, "apps/api/seampact.config.yaml"),
        },
        {
          name: "services/billing",
          directory: join(directory, "services/billing"),
          file: join(directory, "services/billing/seampact.config.yaml"),
        },
      ],
      sources: new Map([["shared", { kind: "path", directory: join(directory, "contracts") }]]),
      allowLocal: false,
      openapi: [
        {
          name: "platform",
          file: join(directory, "openapi/platform.yaml"),
          apps: ["apps/api", "services/billing"],
          prefix: { billing: "billing" },
          options: { extensions: "none" },
        },
        {
          name: "api",
          file: join(directory, "openapi/api.yaml"),
          apps: ["apps/api"],
          prefix: {},
          options: {},
        },
      ],
      checks: { openapi: "warning" },
    },
  });
});

test("refuses the keys of one app in a root config, naming the app config as their place", async () => {
  const { outcome } = await readRoot(
    "apps: [api]\noutDir: gen\ntargets: []\ndiff: { gate: both }\nchecks: { openapi: error, generated: error, matrix: warning }\n",
    { "api/seampact.config.yaml": APP_CONFIG },
  );

  expect(outcome).toMatchObject({ status: "refused" });
  expect(
    outcome.status === "refused"
      ? outcome.problems.map((problem) => [problem.code, problem.where])
      : [],
  ).toEqual([
    ["config.root.app-key", "seampact.config.yaml:2:1 outDir"],
    ["config.root.app-key", "seampact.config.yaml:3:1 targets"],
    ["config.root.app-key", "seampact.config.yaml:4:1 diff"],
    ["config.root.app-key", "seampact.config.yaml:5:27 checks.generated"],
    ["config.root.app-key", "seampact.config.yaml:5:45 checks.matrix"],
  ]);
  expect(outcome.status === "refused" ? outcome.problems[0] : undefined).toMatchObject({
    message: expect.stringContaining("belongs to one app"),
    fix: expect.stringContaining("seampact.config.yaml"),
  });
});

test("refuses an app directory outside the root, the root itself, without a config, or listed twice", async () => {
  const { outcome } = await readRoot("apps: [../elsewhere, ., missing, api, ./api/]\n", {
    "api/seampact.config.yaml": APP_CONFIG,
  });

  expect(outcome).toMatchObject({
    status: "refused",
    problems: [
      {
        code: "config.apps.outside",
        message: expect.stringContaining("not below"),
        where: "seampact.config.yaml:1:8 apps[0]",
      },
      {
        code: "config.apps.outside",
        message: expect.stringContaining("own directory"),
        where: "seampact.config.yaml:1:22 apps[1]",
      },
      { code: "config.apps.no-config", where: "seampact.config.yaml:1:25 apps[2]" },
      { code: "config.apps.duplicate", message: "'./api/' and 'api' name the same app directory." },
    ],
  });
});

test("refuses a merged document covering an app the root does not list", async () => {
  const { outcome } = await readRoot(
    "apps: [api]\nopenapi:\n  all: { path: all.yaml, apps: [web] }\n",
    {
      "api/seampact.config.yaml": APP_CONFIG,
    },
  );

  expect(outcome).toMatchObject({
    status: "refused",
    problems: [
      {
        code: "config.openapi.unknown-app",
        where: "seampact.config.yaml:3:33 openapi.all.apps[0]",
      },
    ],
  });
});

test("takes a merged document's app as the directory it names, in the spelling of `apps`", async () => {
  const { outcome } = await readRoot(
    "apps: [api]\nopenapi:\n  all: { path: all.yaml, apps: [./api/] }\n",
    {
      "api/seampact.config.yaml": APP_CONFIG,
    },
  );

  expect(outcome).toMatchObject({
    status: "read",
    config: { openapi: [{ name: "all", apps: ["api"] }] },
  });
});

test("reads every app of a workspace with the root folded in, and reports every app's problems", async () => {
  const directory = writeConfigTree({
    "seampact.config.yaml": "apps: [api, web]\nsources:\n  shared: { path: ./contracts }\n",
    "api/seampact.config.yaml": APP_CONFIG,
    "web/seampact.config.yaml": "outDir: 3\n",
  });
  const refused = await readWorkspaceConfigs(
    join(directory, "seampact.config.yaml"),
    "seampact.config.yaml",
  );

  expect(refused).toMatchObject({
    status: "refused",
    problems: [{ code: "config.schema", where: "web/seampact.config.yaml:1:1 outDir" }],
  });

  const fixed = writeConfigTree({
    "seampact.config.yaml": "apps: [api]\nsources:\n  shared: { path: ./contracts }\n",
    "api/seampact.config.yaml": APP_CONFIG,
  });
  const read = await readWorkspaceConfigs(
    join(fixed, "seampact.config.yaml"),
    "seampact.config.yaml",
  );

  expect(read).toMatchObject({
    status: "read",
    workspace: {
      apps: [
        {
          app: { name: "api" },
          config: {
            rootFile: join(fixed, "seampact.config.yaml"),
            sources: new Map([
              ["shared", { kind: "path", directory: join(fixed, "contracts") }],
              ["own", { kind: "path", directory: join(fixed, "api/contracts") }],
            ]),
          },
        },
      ],
    },
  });
});
