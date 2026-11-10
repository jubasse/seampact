import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSeampact } from "../dist-smoke/cli-process.ts";
import { REPO_ROOT } from "../golden/repo-root.ts";
import { contractVariant, readContractTrees } from "../golden/variants.ts";

// CHK-103 (FR-9, FR-1, FR-14, FR-38): every Node target generates the same bytes from the reference contract on
// every run, whatever the time zone and the locale, and from the contract with mappings moved to `$include` files
// and example values moved to `$file` files. The generated tree (every file under the app, `contract` and
// `node_modules` aside) is read as bytes. The job `.github/workflows/p8-determinism.yml` runs this file on Linux,
// macOS and Windows, with its own TZ and LANG; the second run of each target overrides both, so one OS also
// proves the independence from them.

const REFERENCE_ROOT = join(REPO_ROOT, "fixtures/reference");
const TARGET_PACKAGES_ROOT = join(REPO_ROOT, "packages/targets");
// The runtime a server target's generated code imports: the generator checks that the app installs it.
const SERVER_RUNTIME_PACKAGE = join(REPO_ROOT, "packages/runtime/server-runtime");
const CONFIG_FILE = "seampact.config.yaml";
const CONTRACT_DIRECTORY = "contract";
const NODE_MODULES_DIRECTORY = "node_modules";
const REFERENCE_FILES = [
  "workspace.yaml",
  "shared/base.yaml",
  "tasks/api.yaml",
  "tasks-service/api.yaml",
  "tasks-service-writes/api.yaml",
  "tasks-devices/api.yaml",
  "tasks-optional-auth/api.yaml",
  "tasks-absolute-urls/api.yaml",
  "tasks-responses/api.yaml",
  "tasks-paging/api.yaml",
  "tasks-split-sort/api.yaml",
];
const INCLUDED_FORM_SEED = 7;
const OTHER_ENVIRONMENT = { TZ: "Pacific/Kiritimati", LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8" };
const TARGET_TEST_TIMEOUT_MILLISECONDS = 180_000;

const APIS = "apis: [tasks, tasksService]";
const TYPES_ENTRY = `  - { id: types, use: "@seampact/codegen-ts", ${APIS} }`;
const VALIDATORS_ENTRY = `  - { id: validators, use: "@seampact/codegen-zod", ${APIS} }`;

function clientEntry(packageName: string): string {
  return `  - { id: client, use: "@seampact/${packageName}", ${APIS}, link: { types: types } }`;
}

function serverEntry(packageName: string): string {
  return `  - id: server
    use: "@seampact/${packageName}"
    ${APIS}
    options: { bodyValidation: true }
    link: { types: types, validators: validators }
`;
}

function queryEntry(packageName: string): string {
  return `  - id: queries
    use: "@seampact/${packageName}"
    ${APIS}
    options: { query: fetch }
    link: { client: client }
`;
}

interface DeterminismCase {
  /** The checklist target. */
  target: string;
  /** The config's target entries. */
  entries: string[];
  /** The framework package the entry's generated code imports: the matrix check reads it from the app's project. */
  framework?: string;
}

const SERVER_ENTRIES = [TYPES_ENTRY, VALIDATORS_ENTRY];
const CLIENT_ENTRIES = [TYPES_ENTRY, clientEntry("codegen-fetch")];

function serverCase(target: string, framework: string): DeterminismCase {
  return { target, framework, entries: [...SERVER_ENTRIES, serverEntry(`codegen-${target}`)] };
}

function validatorsCase(target: string): DeterminismCase {
  return {
    target,
    entries: [TYPES_ENTRY, `  - { id: validators, use: "@seampact/codegen-${target}", ${APIS} }`],
  };
}

function queryCase(target: string, framework: string): DeterminismCase {
  return { target, framework, entries: [...CLIENT_ENTRIES, queryEntry(`codegen-${target}`)] };
}

const DETERMINISM_CASES: readonly DeterminismCase[] = [
  serverCase("nestjs", "@nestjs/core"),
  serverCase("fastify", "fastify"),
  serverCase("express", "express"),
  serverCase("adonis", "@adonisjs/core"),
  serverCase("hono", "hono"),
  serverCase("nextjs", "next"),
  { target: "fetch", entries: CLIENT_ENTRIES },
  { target: "axios", entries: [TYPES_ENTRY, clientEntry("codegen-axios")] },
  validatorsCase("zod"),
  validatorsCase("yup"),
  validatorsCase("class-validator"),
  queryCase("react", "react"),
  queryCase("angular", "@angular/core"),
  queryCase("vue", "vue"),
];

let work: string;
let includedContractFiles: Map<string, string>;

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "seampact-determinism-"));

  const trees = readContractTrees(REFERENCE_ROOT, REFERENCE_FILES);
  const included = contractVariant(trees, INCLUDED_FORM_SEED, true);

  // The included form has to move something, or the comparison proves nothing.
  expect(included.includeDirectives + included.fileDirectives).toBeGreaterThan(0);
  includedContractFiles = included.files;
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

function writeFiles(root: string, files: ReadonlyMap<string, string>): void {
  for (const [path, content] of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function referenceContractFiles(): Map<string, string> {
  const files = new Map<string, string>();

  for (const entry of readdirSync(REFERENCE_ROOT, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;

    const path = join(entry.parentPath, entry.name);

    files.set(relative(REFERENCE_ROOT, path).split("\\").join("/"), readFileSync(path, "utf8"));
  }

  return files;
}

function linkFramework(app: string, target: string, framework: string): void {
  const installed = join(
    TARGET_PACKAGES_ROOT,
    `codegen-${target}`,
    NODE_MODULES_DIRECTORY,
    framework,
  );
  const link = join(app, NODE_MODULES_DIRECTORY, framework);

  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(installed, link, "junction");
}

function linkTargetPackages(app: string): void {
  const scope = join(app, NODE_MODULES_DIRECTORY, "@seampact");

  mkdirSync(scope, { recursive: true });

  for (const directory of readdirSync(TARGET_PACKAGES_ROOT)) {
    symlinkSync(join(TARGET_PACKAGES_ROOT, directory), join(scope, directory), "junction");
  }

  symlinkSync(SERVER_RUNTIME_PACKAGE, join(scope, "server-runtime"), "junction");
}

function writeApp(
  name: string,
  determinismCase: DeterminismCase,
  contract: ReadonlyMap<string, string>,
): string {
  const app = join(work, name);

  linkTargetPackages(app);

  if (determinismCase.framework !== undefined)
    linkFramework(app, determinismCase.target, determinismCase.framework);

  writeFiles(join(app, CONTRACT_DIRECTORY), contract);
  writeFileSync(
    join(app, CONFIG_FILE),
    `sources:\n  contract: { path: ./${CONTRACT_DIRECTORY} }\ntargets:\n${determinismCase.entries.join("\n")}\n`,
  );

  return app;
}

/** Every file the run wrote under the app (not its inputs), as base64 bytes by its slash path. */
function generatedTree(app: string): Map<string, string> {
  const files = new Map<string, string>();
  const inputs = [CONTRACT_DIRECTORY, NODE_MODULES_DIRECTORY, CONFIG_FILE];

  for (const top of readdirSync(app, { withFileTypes: true })) {
    if (inputs.includes(top.name)) continue;

    const topPath = join(app, top.name);
    const paths = top.isDirectory()
      ? readdirSync(topPath, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => join(entry.parentPath, entry.name))
      : [topPath];

    for (const path of paths)
      files.set(relative(app, path).split("\\").join("/"), readFileSync(path).toString("base64"));
  }

  return new Map([...files].sort(([left], [right]) => (left < right ? -1 : 1)));
}

async function generate(
  name: string,
  determinismCase: DeterminismCase,
  contract: ReadonlyMap<string, string>,
  environment: Readonly<Record<string, string>>,
): Promise<Map<string, string>> {
  const app = writeApp(name, determinismCase, contract);
  const run = await runSeampact(["generate"], app, environment);

  expect(run.exitCode, `${name} exit code: ${run.stderr}`).toBe(0);

  const tree = generatedTree(app);

  expect(tree.size, `${name} wrote no file`).toBeGreaterThan(0);

  // The generator's warnings are part of its output: they too are the same on every run.
  tree.set("<stderr>", Buffer.from(run.stderr).toString("base64"));

  return tree;
}

describe("generation determinism", () => {
  it.each(DETERMINISM_CASES)(
    "$target generates the same bytes on every run, under another TZ and LANG, and from the included form",
    async (determinismCase) => {
      const { target } = determinismCase;
      const reference = referenceContractFiles();
      const first = await generate(`${target}-first`, determinismCase, reference, {});
      const second = await generate(
        `${target}-second`,
        determinismCase,
        reference,
        OTHER_ENVIRONMENT,
      );
      const included = await generate(
        `${target}-included`,
        determinismCase,
        includedContractFiles,
        {},
      );

      expect([...second.keys()]).toEqual([...first.keys()]);
      expect(second).toEqual(first);
      expect([...included.keys()]).toEqual([...first.keys()]);
      expect(included).toEqual(first);
    },
    TARGET_TEST_TIMEOUT_MILLISECONDS,
  );
});
