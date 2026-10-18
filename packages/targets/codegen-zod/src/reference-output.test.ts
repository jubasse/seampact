import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type ExportRef, importSpecifier, type Link } from "@seampact/codegen-core";
import type { ContractIR } from "@seampact/spec/ir";
import ts from "typescript";
import { afterAll, expect, test } from "vitest";
import { target } from "./index.js";

const GOLDEN_IRS = ["tasks", "tasksService"];
const OUTPUT_DIRECTORY = "generated";
const PROBE_FILE = "probe.ts";
const REPOSITORY_ROOT = new URL("../../../../", import.meta.url);
const ZOD_TYPES = new URL("../node_modules/zod/index.d.ts", import.meta.url).pathname;

const temporaryRoot = mkdtempSync(join(tmpdir(), "seampact-codegen-zod-"));

afterAll(() => rmSync(temporaryRoot, { recursive: true, force: true }));

function readGoldenIr(name: string): ContractIR {
  return JSON.parse(
    readFileSync(new URL(`fixtures/golden/reference/${name}.ir.json`, REPOSITORY_ROOT), "utf8"),
  );
}

function compilerOptions(): ts.CompilerOptions {
  const basePath = new URL("tsconfig.base.json", REPOSITORY_ROOT).pathname;
  const { config } = ts.readConfigFile(basePath, ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, dirname(basePath));

  // The temporary directory has no `node_modules`: zod resolves to this package's devDependency, and the
  // generated validators need no `@types/node`.
  return { ...options, types: [], paths: { zod: [ZOD_TYPES] } };
}

function probeSource(exportRefs: readonly ExportRef[]): string {
  const link: Link<"validators"> = {
    descriptor: { kind: "validators", style: "standard-schema", schemas: {}, operations: {} },
    location: { kind: "relative", path: OUTPUT_DIRECTORY },
  };

  const imports = exportRefs
    .map((exportRef, index) => {
      const specifier = importSpecifier(link, exportRef, PROBE_FILE);

      return `import { ${exportRef.export} as Probe${index} } from "${specifier}";\nexport const uses${index}: StandardSchema = Probe${index};`;
    })
    .join("\n");

  // The api index re-exports every module; its namespaces keep the two directions' same names apart.
  const indexProbe = `import * as Api from "./${OUTPUT_DIRECTORY}/index.js";\nexport type UsesIndex = keyof typeof Api;`;

  return `type StandardSchema = { "~standard": { version: 1; validate: (value: unknown) => unknown } };\n${imports}\n${indexProbe}`;
}

test.each(GOLDEN_IRS)("the generated reference validators compile: %s", async (name) => {
  const ir = readGoldenIr(name);
  const outcome = await target.generate({
    ir,
    options: {},
    links: {},
    artefacts: new Set(["validators"]),
  });
  const described = target.describe(ir, {});

  expect(outcome).toMatchObject({ status: "generated" });
  expect(described).toMatchObject({ status: "described" });

  if (outcome.status !== "generated" || described.status !== "described") return;

  const descriptor = described.descriptors.validators;

  if (descriptor === undefined)
    throw new Error("the validators target described no validators link");

  const exportRefs = [
    ...Object.values(descriptor.schemas).flatMap((exports) => Object.values(exports)),
    ...Object.values(descriptor.operations).flatMap((exports) => Object.values(exports)),
  ];
  const projectDirectory = join(temporaryRoot, name);

  for (const file of outcome.files) {
    const path = join(projectDirectory, OUTPUT_DIRECTORY, file.path);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.contents);
  }

  writeFileSync(join(projectDirectory, "package.json"), '{ "type": "module" }\n');
  writeFileSync(join(projectDirectory, PROBE_FILE), probeSource(exportRefs));

  const rootNames = [PROBE_FILE, ...outcome.files.map((file) => join(OUTPUT_DIRECTORY, file.path))];
  const program = ts.createProgram(
    rootNames.map((rootName) => join(projectDirectory, rootName)),
    compilerOptions(),
  );
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));

  expect(outcome.files.map((file) => file.path)).toContain("index.ts");
  expect(exportRefs.length).toBeGreaterThan(0);
  expect(diagnostics).toEqual([]);
});
