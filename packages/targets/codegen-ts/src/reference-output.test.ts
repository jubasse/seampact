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

const temporaryRoot = mkdtempSync(join(tmpdir(), "seampact-codegen-ts-"));

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

  // The temporary directory has no `@types/node`, and the generated types need none.
  return { ...options, types: [] };
}

function probeSource(exportRefs: readonly ExportRef[]): string {
  const link: Link<"types"> = {
    descriptor: { kind: "types", style: "typescript", schemas: {}, operations: {} },
    location: { kind: "relative", path: OUTPUT_DIRECTORY },
  };

  return exportRefs
    .map((exportRef, index) => {
      const specifier = importSpecifier(link, exportRef, PROBE_FILE);

      return `import type { ${exportRef.export} as Probe${index} } from "${specifier}";\nexport type Uses${index} = Probe${index};`;
    })
    .join("\n");
}

test.each(GOLDEN_IRS)("the generated reference types compile: %s", async (name) => {
  const ir = readGoldenIr(name);
  const outcome = await target.generate({
    ir,
    options: {},
    links: {},
    artefacts: new Set(["types"]),
  });
  const described = target.describe(ir, {});

  expect(outcome).toMatchObject({ status: "generated" });
  expect(described).toMatchObject({ status: "described" });

  if (outcome.status !== "generated" || described.status !== "described") return;

  const descriptor = described.descriptors.types;

  if (descriptor === undefined) throw new Error("the types target described no types link");

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

  expect(exportRefs.length).toBeGreaterThan(0);
  expect(diagnostics).toEqual([]);
});
