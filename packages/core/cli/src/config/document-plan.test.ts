import type { TargetRole } from "@seampact/codegen-core";
import type { AppOpenApi, TargetEntry } from "@seampact/spec/config";
import { expect, test } from "vitest";
import { type ApiDocuments, planAppDocuments, planMergedDocuments } from "./document-plan.js";
import type { LoadedAppConfig } from "./read-app-config.js";
import type { LoadedWorkspace } from "./read-workspace-configs.js";

const APP_FILE = "/repo/app/seampact.config.yaml";

// `tasks` declares two documents, `billing` none.
const API_DOCUMENTS: readonly ApiDocuments[] = [
  { source: "contracts", api: "tasks", documents: ["public", "full"] },
  { source: "contracts", api: "billing", documents: [] },
];

function appConfig(entries: TargetEntry[], openapi?: AppOpenApi): LoadedAppConfig {
  return {
    file: APP_FILE,
    outDir: "/repo/app/__generated__",
    sources: new Map(),
    entries: entries.map((entry) => ({
      entry,
      root: `/repo/app/__generated__/${entry.out ?? entry.id}`,
    })),
    ...(openapi === undefined ? {} : { openapi }),
  };
}

const SERVER: TargetEntry = {
  id: "server",
  use: "@seampact/codegen-nestjs",
  apis: ["tasks", "contracts/billing"],
};
const CLIENT: TargetEntry = { id: "client", use: "@seampact/codegen-fetch", api: "tasks" };
const ROLES = new Map<string, TargetRole>([
  ["server", "server"],
  ["client", "client"],
]);

function plannedFiles(config: LoadedAppConfig) {
  const plan = planAppDocuments(config, ROLES, API_DOCUMENTS);

  if (plan.status === "refused") return plan.problems.map((problem) => problem.code);

  return plan.documents.map(({ api, document, file, options }) => ({
    api,
    document,
    file,
    options,
  }));
}

test("writes every document of every api a server target serves when the app has no openapi key", () => {
  expect(plannedFiles(appConfig([SERVER, CLIENT]))).toEqual([
    { api: "tasks", document: "public", file: "/repo/app/openapi/tasks.public.yaml", options: {} },
    { api: "tasks", document: "full", file: "/repo/app/openapi/tasks.full.yaml", options: {} },
    { api: "billing", document: undefined, file: "/repo/app/openapi/billing.yaml", options: {} },
  ]);
});

test("writes no document for an app with client targets only, or with openapi none", () => {
  expect(plannedFiles(appConfig([CLIENT]))).toEqual([]);
  expect(plannedFiles(appConfig([SERVER], "none"))).toEqual([]);
});

test("writes the documents the openapi key lists, with their options, for an app with or without targets", () => {
  const openapi: AppOpenApi = {
    tasks: {
      public: "docs/public.yaml",
      full: { path: "docs/full.yaml", reasons: "omit", extensions: ["access"] },
    },
    billing: { path: "../billing.yaml", servers: [{ url: "https://billing.example.com" }] },
  };
  const expected = [
    { api: "tasks", document: "public", file: "/repo/app/docs/public.yaml", options: {} },
    {
      api: "tasks",
      document: "full",
      file: "/repo/app/docs/full.yaml",
      options: { reasons: "omit", extensions: ["access"] },
    },
    {
      api: "billing",
      document: undefined,
      file: "/repo/billing.yaml",
      options: { servers: [{ url: "https://billing.example.com" }] },
    },
  ];

  expect(plannedFiles(appConfig([CLIENT], openapi))).toEqual(expected);
  expect(plannedFiles(appConfig([], openapi))).toEqual(expected);
});

test("refuses a listed api or document the sources do not hold, and one path for an api with several documents", () => {
  expect(plannedFiles(appConfig([], { tasks: "tasks.yaml" }))).toEqual([
    "config.openapi.document-needed",
  ]);
  expect(plannedFiles(appConfig([], { billing: { full: "b.yaml" } }))).toEqual([
    "config.openapi.no-documents",
  ]);
  expect(plannedFiles(appConfig([], { tasks: { internal: "t.yaml" } }))).toEqual([
    "config.openapi.unknown-document",
  ]);
  expect(plannedFiles(appConfig([], { orders: "o.yaml" }))).toEqual(["config.openapi.unknown-api"]);

  const twoSources = planAppDocuments(appConfig([], { tasks: { public: "t.yaml" } }), ROLES, [
    ...API_DOCUMENTS,
    { source: "other", api: "tasks", documents: ["public"] },
  ]);

  expect(twoSources).toMatchObject({
    status: "refused",
    problems: [{ code: "config.openapi.ambiguous-api" }],
  });
});

test("refuses two documents on one path and a document inside an entry's output directory", () => {
  expect(
    plannedFiles(appConfig([], { tasks: { public: "same.yaml", full: "same.yaml" } })),
  ).toEqual(["config.openapi.path-conflict"]);
  expect(
    plannedFiles(appConfig([CLIENT], { billing: "__generated__/client/billing.yaml" })),
  ).toEqual(["config.openapi.inside-output"]);
});

function workspaceApp(name: string, config: LoadedAppConfig) {
  return {
    app: { name, directory: `/repo/${name}`, file: `/repo/${name}/seampact.config.yaml` },
    config,
  };
}

test("takes a merged document's contributions from server entries and OpenAPI-only apps, none from client apps", () => {
  const workspace: LoadedWorkspace = {
    root: {
      file: "/repo/seampact.config.yaml",
      displayName: "seampact.config.yaml",
      apps: [],
      sources: new Map(),
      checks: {},
      openapi: [
        {
          name: "platform",
          file: "/repo/openapi/platform.yaml",
          apps: ["api", "billing", "web"],
          prefix: { billing: "billing" },
          options: { extensions: "none" },
        },
        { name: "api", file: "/repo/openapi/api.yaml", apps: ["api"], prefix: {}, options: {} },
      ],
    },
    apps: [
      workspaceApp(
        "api",
        appConfig([{ ...SERVER, document: "public", operations: { exclude: ["admin"] } }, CLIENT]),
      ),
      workspaceApp(
        "billing",
        appConfig([], { billing: "openapi/billing.yaml", tasks: { full: "t.yaml" } }),
      ),
      workspaceApp("web", appConfig([CLIENT], { tasks: { public: "t.yaml" } })),
    ],
  };
  const plan = planMergedDocuments(
    workspace,
    new Map([
      ["api", ROLES],
      ["web", ROLES],
    ]),
  );

  expect(plan).toEqual({
    status: "planned",
    documents: [
      {
        name: "platform",
        file: "/repo/openapi/platform.yaml",
        options: { extensions: "none" },
        prefix: { billing: "billing" },
        contributions: [
          {
            app: "api",
            api: "tasks",
            entry: "server",
            document: "public",
            operations: { exclude: ["admin"] },
          },
          {
            app: "api",
            api: "contracts/billing",
            entry: "server",
            document: "public",
            operations: { exclude: ["admin"] },
          },
          { app: "billing", api: "billing" },
          { app: "billing", api: "tasks", document: "full" },
        ],
      },
      {
        name: "api",
        file: "/repo/openapi/api.yaml",
        options: {},
        prefix: {},
        contributions: [
          {
            app: "api",
            api: "tasks",
            entry: "server",
            document: "public",
            operations: { exclude: ["admin"] },
          },
          {
            app: "api",
            api: "contracts/billing",
            entry: "server",
            document: "public",
            operations: { exclude: ["admin"] },
          },
        ],
      },
    ],
  });
});
