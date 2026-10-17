import { expect, test } from "vitest";
import {
  treeNodesApiOf,
  treeNodesLoadFiles,
  treeNodesLoadInline,
  treeNodesRun,
  treeNodesStubService,
} from "./test-support.js";

const treeSchemas = treeNodesStubService({});

interface PathVersionCase {
  readonly name: string;
  readonly version: string;
  readonly conventions?: string;
  readonly prefix: string;
  readonly pathVersion?: "prefix" | "none";
  readonly expected: {
    readonly prefix: string;
    readonly path: string;
    readonly rules: readonly string[];
  };
}

// ADR 0002 section 6: a prefix holds {version} or gets /v{version} in front of it; `pathVersion: none` (in the
// conventions or on the surface) uses it as written; else a literal version segment is refused.
const PATH_VERSION_CASES: readonly PathVersionCase[] = [
  {
    name: "a prefix with {version}",
    version: "1",
    prefix: "/v{version}/app",
    expected: { prefix: "/v1/app", path: "/v1/app/audit-log", rules: [] },
  },
  {
    name: "a prefix without {version}",
    version: "2",
    prefix: "/hooks",
    expected: { prefix: "/v2/hooks", path: "/v2/hooks/audit-log", rules: [] },
  },
  {
    name: "pathVersion none in the conventions",
    version: "1",
    conventions: "conventions: { pathVersion: none }",
    prefix: "/stripe",
    expected: { prefix: "/stripe", path: "/stripe/audit-log", rules: [] },
  },
  {
    name: "a string version with every surface unversioned",
    version: "'2024-06-20'",
    prefix: "/api/",
    pathVersion: "none",
    expected: { prefix: "/api", path: "/api/audit-log", rules: [] },
  },
  {
    name: "a string version with a versioned surface",
    version: "'2024-06-20'",
    prefix: "/v{version}",
    expected: { prefix: "/v2024-06-20", path: "/v2024-06-20/audit-log", rules: ["api-version"] },
  },
  {
    name: "a literal version segment",
    version: "1",
    prefix: "/v2/app",
    expected: { prefix: "/v1/v2/app", path: "/v1/v2/app/audit-log", rules: ["path-version"] },
  },
  {
    name: "a literal version segment under pathVersion none, used as written",
    version: "2",
    prefix: "/stripe/v1",
    pathVersion: "none",
    expected: { prefix: "/stripe/v1", path: "/stripe/v1/audit-log", rules: [] },
  },
  {
    name: "a prefix without a leading slash",
    version: "1",
    prefix: "stripe",
    pathVersion: "none",
    expected: { prefix: "/stripe", path: "/stripe/audit-log", rules: [] },
  },
  {
    name: "a placeholder other than {version} in a prefix",
    version: "1",
    prefix: "/v{version}/{tenant}",
    expected: { prefix: "/v1/{tenant}", path: "/v1/{tenant}/audit-log", rules: ["path-param"] },
  },
  {
    name: "{version} under pathVersion none",
    version: "1",
    prefix: "/v{version}",
    pathVersion: "none",
    expected: { prefix: "/v{version}", path: "/v{version}/audit-log", rules: ["path-version"] },
  },
];

test.each(PATH_VERSION_CASES)(
  "path versions: $name",
  ({ version, conventions, prefix, pathVersion, expected }) => {
    const workspace = treeNodesLoadInline(`
api: { name: audit, version: ${version}, kind: product }
${conventions ?? ""}
surfaces:
  app:
    prefix: ${prefix}
    ${pathVersion === undefined ? "" : `pathVersion: ${pathVersion}`}
    routes:
      auditLog: { method: get }
`);
    const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
      treeSchemas,
    });

    expect(draft.api?.surfaces.app?.prefix).toBe(expected.prefix);
    expect(draft.operations[0]?.path).toBe(expected.path);
    expect(diagnostics.map(({ rule }) => rule)).toEqual(
      expected.rules.map((rule) => `seampact/tree/${rule}`),
    );
  },
);

test("path versions: the api's path version, the version kind and the mismatch stated", () => {
  const written = treeNodesLoadInline(`
api: { name: audit, version: 3, kind: product }
conventions: { pathVersion: prefix, pathCase: snake }
surfaces:
  app:
    prefix: /v2
    routes:
      auditLog: { method: get }
      byDay: { method: get, path: 'days/{day}', pathParams: { day: { type: string } } }
`);
  const run = treeNodesRun(treeNodesApiOf(written), written, { treeSchemas });

  expect(run.draft.api?.version).toEqual({ kind: "path", number: 3 });
  expect(run.draft.api?.pathVersion).toEqual({
    value: "prefix",
    origin: { layer: "api", pointer: "/conventions/pathVersion" },
  });
  expect(run.draft.operations.map(({ path }) => path)).toEqual([
    "/v3/v2/audit_log",
    "/v3/v2/days/{day}",
  ]);
  expect(run.diagnostics.map(({ message, origin }) => ({ message, origin }))).toEqual([
    {
      message:
        "The prefix /v2 of the surface app holds the literal version segment v2, which differs from the api version 3; the version is held once, on the api.",
      origin: { layer: "api", pointer: "/surfaces/app/prefix" },
    },
  ]);

  const label = treeNodesLoadInline(`
api: { name: audit, version: '2024-06-20', kind: product }
surfaces:
  app: { prefix: /audit, pathVersion: none, routes: { ping: { method: get } } }
`);
  const labelled = treeNodesRun(treeNodesApiOf(label), label, { treeSchemas });

  expect(labelled.draft.api?.version).toEqual({ kind: "label", label: "2024-06-20" });
  expect(labelled.draft.api?.pathVersion).toEqual({
    value: "prefix",
    origin: { layer: "api", pointer: "/api/version" },
  });
});

const HOUSE_PACK = `
pack: { name: house, version: 2.1.0, extends: [] }
conventions:
  pathCase: snake
lint:
  rules: { seampact/redundant-maturity: disabled }
`;

const SETTINGS_API = `
api:
  name: billing
  version: 1
  kind: service
  role: gateway
  caller: { identity: service, right: callerService }
  summary: Invoices.
  description: Invoices sent to customers.
  documents:
    internalOnly: { surfaces: [ops], internal: include }
    everything: {}
packs: [./house.yaml]
conventions:
  bodyLimit: 2MiB
  query: { unknownKeys: { ignore: "Gateways add tracking keys." } }
lint:
  rules: { seampact/credential-name: error }
services:
  ledger: { maturity: stable }
  mailer: {}
schemas:
  Invoice:
    type: object
    properties:
      token: { type: string, lint: { allow: { seampact/credential-name: "A public share token." } } }
      lines:
        type: array
        items:
          type: object
          properties:
            secret: { type: string, lint: { allow: { seampact/credential-name: "A line label." } } }
    lint: { allow: { seampact/unused-declaration: "Kept for the next version." } }
surfaces:
  app:
    prefix: /v{version}
    lint: { allow: { seampact/subtree-exception: "Probes are public on purpose." } }
    routes:
      invoices:
        kind: single
        lint: { allow: { seampact/redundant-maturity: "Stated for the docs." } }
        routes:
          list:
            method: get
            query:
              apiKey?: { type: string, lint: { allow: { seampact/credential-name: "A public key." } } }
  ops:
    prefix: /ops
    routes:
      health: { method: get }
`;

test("api, conventions, lint, packs and services, with allows at any schema depth", () => {
  const workspace = treeNodesLoadFiles({ "api.yaml": SETTINGS_API, "house.yaml": HOUSE_PACK });
  const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
  });

  expect(diagnostics).toEqual([]);
  expect(draft.api).toEqual({
    id: "billing",
    name: { segments: ["billing"], role: "schema" },
    version: { kind: "path", number: 1 },
    kind: "service",
    pathVersion: { value: "prefix", origin: { layer: "api", pointer: "/api/version" } },
    role: "gateway",
    maturity: "experimental",
    caller: { identity: "service", right: "callerService" },
    compat: { policy: "none" },
    surfaces: {
      app: {
        name: { segments: ["app"], role: "schema" },
        prefix: "/v1",
        pathVersion: "prefix",
        origin: { layer: "api", pointer: "/surfaces/app" },
      },
      ops: {
        name: { segments: ["ops"], role: "schema" },
        prefix: "/v1/ops",
        pathVersion: "prefix",
        origin: { layer: "api", pointer: "/surfaces/ops" },
      },
    },
    documents: {
      internalOnly: { surfaces: ["ops"], internal: "include" },
      everything: { surfaces: ["app", "ops"], internal: "include" },
    },
    docs: { summary: "Invoices.", description: "Invoices sent to customers." },
    extensions: {},
    origin: { layer: "api", pointer: "/api" },
  });

  // Written conventions only: `batch.bodyLimit` reads `bodyLimit`, and core defaults have no origin.
  expect(draft.conventions).toEqual({
    pathCase: { value: "snake", origin: { layer: "pack:house", pointer: "/conventions/pathCase" } },
    bodyLimit: { value: "2MiB", origin: { layer: "api", pointer: "/conventions/bodyLimit" } },
    "query.unknownKeys": {
      value: { ignore: "Gateways add tracking keys." },
      origin: { layer: "api", pointer: "/conventions/query/unknownKeys" },
    },
  });
  expect(draft.operations.map(({ path }) => path)).toEqual(["/v1/invoices/list", "/v1/ops/health"]);

  expect(draft.lint).toEqual({
    rules: {
      "seampact/redundant-maturity": {
        severity: "disabled",
        origin: { layer: "pack:house", pointer: "/lint/rules/seampact~1redundant-maturity" },
      },
      "seampact/credential-name": {
        severity: "error",
        origin: { layer: "api", pointer: "/lint/rules/seampact~1credential-name" },
      },
    },
    allows: [
      {
        rule: "seampact/subtree-exception",
        at: { layer: "api", pointer: "/surfaces/app" },
        reason: "Probes are public on purpose.",
        subtree: false,
      },
      {
        rule: "seampact/redundant-maturity",
        at: { layer: "api", pointer: "/surfaces/app/routes/invoices" },
        reason: "Stated for the docs.",
        subtree: true,
      },
      {
        rule: "seampact/credential-name",
        at: { layer: "api", pointer: "/surfaces/app/routes/invoices/routes/list/query/apiKey?" },
        reason: "A public key.",
        subtree: false,
      },
      {
        rule: "seampact/unused-declaration",
        at: { layer: "api", pointer: "/schemas/Invoice" },
        reason: "Kept for the next version.",
        subtree: false,
      },
      {
        rule: "seampact/credential-name",
        at: { layer: "api", pointer: "/schemas/Invoice/properties/token" },
        reason: "A public share token.",
        subtree: false,
      },
      {
        rule: "seampact/credential-name",
        at: { layer: "api", pointer: "/schemas/Invoice/properties/lines/items/properties/secret" },
        reason: "A line label.",
        subtree: false,
      },
    ],
  });

  expect(draft.packs).toEqual([{ name: "house", version: "2.1.0" }]);
  // A service that states no maturity is as mature as the api.
  expect(draft.services).toEqual({
    ledger: {
      id: "ledger",
      maturity: "stable",
      origin: { layer: "api", pointer: "/services/ledger" },
    },
    mailer: {
      id: "mailer",
      maturity: "experimental",
      origin: { layer: "api", pointer: "/services/mailer" },
    },
  });
});

test("path versions: pathVersion none set by a pack", () => {
  const workspace = treeNodesLoadFiles({
    "api.yaml": `
api: { name: audit, version: '2024-06-20', kind: product }
packs: [./unversioned.yaml]
surfaces:
  app: { prefix: /audit, routes: { ping: { method: get } } }
`,
    "unversioned.yaml": `
pack: { name: unversioned, version: 1.0.0, extends: [] }
conventions: { pathVersion: none }
`,
  });
  const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
  });

  expect(diagnostics).toEqual([]);
  expect(draft.api?.pathVersion).toEqual({
    value: "none",
    origin: { layer: "pack:unversioned", pointer: "/conventions/pathVersion" },
  });
  expect(draft.operations[0]?.path).toBe("/audit/ping");
});
