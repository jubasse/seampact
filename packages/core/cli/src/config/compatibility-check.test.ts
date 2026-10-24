import { join } from "node:path";
import type { Target } from "@seampact/codegen-core";
import { ALL_TARGETS, type TargetCompatibility } from "@seampact/spec/compatibility";
import type { MatrixCheckLevel, TargetEntry } from "@seampact/spec/config";
import { afterEach, expect, test } from "vitest";
import {
  type CompatibilityOutcome,
  checkAppCompatibility,
  checkCompatibility,
} from "./compatibility-check.js";
import { removeConfigTrees, writeConfigTree } from "./config-test-tree.test-support.js";
import { stubTarget } from "./target-stub.test-support.js";

const SERVER_PACKAGE = "@acme/codegen-server";

afterEach(removeConfigTrees);

// A matrix whose framework is tested on 4 and 5 and known broken on 3.
const MATRIX: readonly TargetCompatibility[] = [
  {
    package: SERVER_PACKAGE,
    framework: {
      id: "web",
      package: "web-framework",
      tested: [
        { major: 4, consumer: "web4" },
        { major: 5, consumer: "web" },
      ],
      incompatible: [{ major: 3, reason: "its router has no route listing." }],
    },
    validatorStyles: ["standard-schema"],
    ownValidators: [],
  },
];

interface CheckCase {
  installedMajor: number;
  allowUntested?: string[];
  level?: MatrixCheckLevel;
  use?: string;
}

function check({
  installedMajor,
  allowUntested,
  level = "warning",
  use = SERVER_PACKAGE,
}: CheckCase): CompatibilityOutcome {
  const entry: TargetEntry = {
    id: "server",
    use,
    api: "tasks",
    ...(allowUntested === undefined ? {} : { allowUntested }),
  };
  const targets = new Map<string, Target>([["server", stubTarget(use)]]);
  const installedVersions = new Map([
    [
      "server",
      { packageName: "web-framework", version: `${installedMajor}.1.0`, major: installedMajor },
    ],
  ]);

  return checkCompatibility({
    entries: [entry],
    targets,
    installedVersions,
    matrix: MATRIX,
    level,
  });
}

const UNTESTED = {
  code: "config.matrix.untested",
  message:
    "web-framework 6.1.0 is installed, and the target '@acme/codegen-server' is tested on web 4, 5 only.",
  fix: "Install a tested major, or accept this one with `allowUntested: [web@6]` on the entry.",
  where: "entry 'server'",
};

test("passes a tested major", () => {
  expect(check({ installedMajor: 5 })).toEqual({ problems: [], warnings: [] });
});

test("warns on an untested major, naming the tested ones (CHK-141)", () => {
  expect(check({ installedMajor: 6 })).toEqual({ problems: [], warnings: [UNTESTED] });
});

test("refuses an untested major under checks.matrix: error", () => {
  expect(check({ installedMajor: 6, level: "error" })).toEqual({
    problems: [UNTESTED],
    warnings: [],
  });
});

test("accepts an untested major allowUntested names, under either level", () => {
  expect(check({ installedMajor: 6, allowUntested: ["web@6"], level: "error" })).toEqual({
    problems: [],
    warnings: [],
  });
});

test("refuses an incompatible major naming the reason and the tested majors, allowUntested or not (CHK-115)", () => {
  const incompatible = {
    code: "config.matrix.incompatible",
    message:
      "web-framework 3.1.0 is installed, and the target '@acme/codegen-server' does not work on web 3: its router has no route listing.",
    fix: "Install a major of web-framework the target is tested on: 4, 5.",
    where: "entry 'server'",
  };

  expect(check({ installedMajor: 3 })).toEqual({ problems: [incompatible], warnings: [] });
  expect(check({ installedMajor: 3, allowUntested: ["web@3"] })).toEqual({
    problems: [incompatible],
    warnings: [],
  });
});

test("refuses an allowUntested item naming another framework, naming the target's", () => {
  expect(check({ installedMajor: 5, allowUntested: ["express@6"] })).toEqual({
    problems: [
      {
        code: "config.matrix.unknown-framework",
        message:
          "The `allowUntested` item 'express@6' names the framework 'express', and the target '@acme/codegen-server' serves 'web'.",
        fix: "Write the item as 'web@<major>', or remove it.",
        where: "entry 'server'",
      },
    ],
    warnings: [],
  });
});

test("warns that an item naming a tested major can go", () => {
  expect(check({ installedMajor: 5, allowUntested: ["web@4"] })).toEqual({
    problems: [],
    warnings: [
      {
        code: "config.matrix.allowed-tested",
        message:
          "The `allowUntested` item 'web@4' names a major the compatibility matrix tests the target '@acme/codegen-server' on, so it accepts nothing.",
        fix: "Remove 'web@4' from the entry's `allowUntested`.",
        where: "entry 'server'",
      },
    ],
  });
});

test("checks no framework for a target the matrix does not record, and refuses allowUntested on it", () => {
  expect(check({ installedMajor: 6, use: "@acme/codegen-client" })).toEqual({
    problems: [],
    warnings: [],
  });
  expect(
    check({ installedMajor: 6, use: "@acme/codegen-client", allowUntested: ["web@6"] }),
  ).toEqual({
    problems: [
      {
        code: "config.matrix.unrecorded-target",
        message:
          "The compatibility matrix records no framework for the target '@acme/codegen-client', so `allowUntested` has nothing to accept.",
        fix: "Remove `allowUntested` from the entry.",
        where: "entry 'server'",
      },
    ],
    warnings: [],
  });
});

test("accepts an empty allowUntested on a target the matrix does not record", () => {
  expect(check({ installedMajor: 6, use: "@acme/codegen-client", allowUntested: [] })).toEqual({
    problems: [],
    warnings: [],
  });
});

test("reads the framework from the project of the entry's output directory, where the generated code imports it", () => {
  const root = writeConfigTree({
    "app/seampact.config.yaml": "",
    "app/node_modules/web-framework/package.json": JSON.stringify({ version: "3.0.0" }),
    "server/node_modules/web-framework/package.json": JSON.stringify({ version: "5.0.0" }),
  });
  const entry: TargetEntry = { id: "server", use: SERVER_PACKAGE, api: "tasks" };
  const config = {
    file: join(root, "app/seampact.config.yaml"),
    outDir: join(root, "server"),
    sources: new Map(),
    entries: [{ entry, root: join(root, "server/src/generated") }],
    checks: { matrix: "error" as const },
  };

  expect(
    checkAppCompatibility(config, new Map([["server", stubTarget(SERVER_PACKAGE)]]), MATRIX),
  ).toEqual({ problems: [], warnings: [] });
});

const DOCS_MATRIX: readonly TargetCompatibility[] = MATRIX.map((record) => ({
  ...record,
  libraries: [
    { id: "web-docs", package: "web-docs-library", artefact: "nativeDocs", testedMajors: [2] },
  ],
}));

const DOCS_ARTEFACTS = [
  { id: "boundary", defaultOn: true },
  { id: "nativeDocs", defaultOn: false, needs: ["boundary"] },
] as const;

function docsLibraryConfig(root: string, entry: TargetEntry) {
  return {
    file: join(root, "app/seampact.config.yaml"),
    outDir: join(root, "app"),
    sources: new Map(),
    entries: [{ entry, root: join(root, "app/src/generated") }],
    checks: { matrix: "error" as const },
  };
}

function docsLibraryTree(libraryVersion: string): string {
  return writeConfigTree({
    "app/seampact.config.yaml": "",
    "app/node_modules/web-framework/package.json": JSON.stringify({ version: "5.0.0" }),
    "app/node_modules/web-docs-library/package.json": JSON.stringify({ version: libraryVersion }),
  });
}

test("checks the docs library of a target when its artefact is on, and accepts it in allowUntested", () => {
  const root = docsLibraryTree("3.0.0");
  const targets = new Map([["server", stubTarget(SERVER_PACKAGE, DOCS_ARTEFACTS)]]);
  const entry: TargetEntry = {
    id: "server",
    use: SERVER_PACKAGE,
    api: "tasks",
    artefacts: { nativeDocs: true },
  };

  expect(checkAppCompatibility(docsLibraryConfig(root, entry), targets, DOCS_MATRIX)).toEqual({
    problems: [
      {
        code: "config.matrix.untested",
        message:
          "web-docs-library 3.0.0 is installed, and the target '@acme/codegen-server' is tested on web-docs 2 only.",
        fix: "Install a tested major, or accept this one with `allowUntested: [web-docs@3]` on the entry.",
        where: "entry 'server'",
      },
    ],
    warnings: [],
  });
  expect(
    checkAppCompatibility(
      docsLibraryConfig(root, { ...entry, allowUntested: ["web-docs@3"] }),
      targets,
      DOCS_MATRIX,
    ),
  ).toEqual({ problems: [], warnings: [] });
});

test("reads no docs library while its artefact is off", () => {
  const root = writeConfigTree({
    "app/seampact.config.yaml": "",
    "app/node_modules/web-framework/package.json": JSON.stringify({ version: "5.0.0" }),
  });
  const targets = new Map([["server", stubTarget(SERVER_PACKAGE, DOCS_ARTEFACTS)]]);
  const entry: TargetEntry = { id: "server", use: SERVER_PACKAGE, api: "tasks" };

  expect(checkAppCompatibility(docsLibraryConfig(root, entry), targets, DOCS_MATRIX)).toEqual({
    problems: [],
    warnings: [],
  });
});

test("refuses a docs library that is not installed, naming the install command", () => {
  const root = writeConfigTree({
    "app/seampact.config.yaml": "",
    "app/node_modules/web-framework/package.json": JSON.stringify({ version: "5.0.0" }),
  });
  const targets = new Map([["server", stubTarget(SERVER_PACKAGE, DOCS_ARTEFACTS)]]);
  const entry: TargetEntry = {
    id: "server",
    use: SERVER_PACKAGE,
    api: "tasks",
    artefacts: { nativeDocs: true },
  };
  const outcome = checkAppCompatibility(docsLibraryConfig(root, entry), targets, DOCS_MATRIX);

  expect(outcome.problems).toMatchObject([
    { code: "config.matrix.framework-missing", fix: expect.stringContaining("web-docs-library") },
  ]);
});

const OWN_VALIDATORS_MATRIX: readonly TargetCompatibility[] = MATRIX.map((record) => ({
  ...record,
  ownValidators: [{ id: "own", library: "own-validators-library" }],
}));

const OWN_VALIDATORS_ARTEFACTS = [
  { id: "boundary", defaultOn: true },
  { id: "validators", defaultOn: true },
] as const;

function ownValidatorsCheck(entry: TargetEntry, installLibrary: boolean): CompatibilityOutcome {
  const root = writeConfigTree({
    "app/seampact.config.yaml": "",
    "app/node_modules/web-framework/package.json": JSON.stringify({ version: "5.0.0" }),
    ...(installLibrary
      ? {
          "app/node_modules/own-validators-library/package.json": JSON.stringify({
            version: "8.0.0",
          }),
        }
      : {}),
  });
  const targets = new Map([["server", stubTarget(SERVER_PACKAGE, OWN_VALIDATORS_ARTEFACTS)]]);

  return checkAppCompatibility(docsLibraryConfig(root, entry), targets, OWN_VALIDATORS_MATRIX);
}

test("refuses a target's own validators library that is not installed, naming the install command", () => {
  const entry: TargetEntry = { id: "server", use: SERVER_PACKAGE, api: "tasks" };

  expect(ownValidatorsCheck(entry, false).problems).toMatchObject([
    {
      code: "config.own-validators.library-missing",
      fix: expect.stringContaining("own-validators-library"),
    },
  ]);
  expect(ownValidatorsCheck(entry, true)).toEqual({ problems: [], warnings: [] });
});

test("reads no own validators library when the entry links a validators provider", () => {
  const entry: TargetEntry = {
    id: "server",
    use: SERVER_PACKAGE,
    api: "tasks",
    link: { validators: "zod" },
  };

  expect(ownValidatorsCheck(entry, false)).toEqual({ problems: [], warnings: [] });
});

test("warns on an untested React major from the shipped matrix, naming the tested one", () => {
  const entry: TargetEntry = {
    id: "front",
    use: "@seampact/codegen-react",
    api: "tasks",
    options: { query: "swr" },
  };
  const outcome = checkCompatibility({
    entries: [entry],
    targets: new Map<string, Target>([["front", stubTarget("@seampact/codegen-react")]]),
    installedVersions: new Map([["front", { packageName: "react", version: "18.3.1", major: 18 }]]),
    installedLibraries: new Map([["front", [{ packageName: "swr", version: "2.3.0", major: 2 }]]]),
    matrix: ALL_TARGETS,
    level: "warning",
  });

  expect(outcome.problems).toEqual([]);
  expect(outcome.warnings.map((warning) => warning.message)).toEqual([
    "react 18.3.1 is installed, and the target '@seampact/codegen-react' is tested on react 19 only.",
  ]);
});

function reactConfig(root: string, entry: TargetEntry) {
  return {
    file: join(root, "app/seampact.config.yaml"),
    outDir: join(root, "app"),
    sources: new Map(),
    entries: [{ entry, root: join(root, "app/src/generated") }],
    checks: { matrix: "error" as const },
  };
}

test("reads only the query library the entry's `query` option selects", () => {
  const root = writeConfigTree({
    "app/seampact.config.yaml": "",
    "app/node_modules/react/package.json": JSON.stringify({ version: "19.0.0" }),
    "app/node_modules/swr/package.json": JSON.stringify({ version: "2.3.0" }),
  });
  const targets = new Map([
    ["front", stubTarget("@seampact/codegen-react", [{ id: "queries", defaultOn: true }])],
  ]);
  const entry = (query: string): TargetEntry => ({
    id: "front",
    use: "@seampact/codegen-react",
    api: "tasks",
    options: { query },
  });

  expect(checkAppCompatibility(reactConfig(root, entry("swr")), targets)).toEqual({
    problems: [],
    warnings: [],
  });

  const tanstack = checkAppCompatibility(reactConfig(root, entry("tanstack")), targets);

  expect(tanstack.problems.map((problem) => problem.code)).toEqual([
    "config.matrix.framework-missing",
  ]);
  expect(tanstack.problems[0]?.message).toContain("The library '@tanstack/react-query'");
});
