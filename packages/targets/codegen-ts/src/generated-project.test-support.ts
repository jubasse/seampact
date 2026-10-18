import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GeneratedFile } from "@seampact/codegen-core";
import type { ContractIR } from "@seampact/spec/ir";
import ts from "typescript";

// Test support: reads a golden IR and type-checks generated files beside a probe file that imports them.

export const OUTPUT_DIRECTORY = "generated";
export const PROBE_FILE = "probe.ts";

const REPOSITORY_ROOT = new URL("../../../../", import.meta.url);

export function readGoldenIr(name: string): ContractIR {
  return JSON.parse(
    readFileSync(new URL(`fixtures/golden/reference/${name}.ir.json`, REPOSITORY_ROOT), "utf8"),
  );
}

// Writes the files under `generated/` of the project directory, and the probe beside them; returns the type
// errors of the whole project.
export function typeErrorsOf(
  projectDirectory: string,
  files: readonly GeneratedFile[],
  probe: string,
): string[] {
  for (const file of files) {
    const path = join(projectDirectory, OUTPUT_DIRECTORY, file.path);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.contents);
  }

  writeFileSync(join(projectDirectory, "package.json"), '{ "type": "module" }\n');
  writeFileSync(join(projectDirectory, PROBE_FILE), probe);

  const rootNames = [PROBE_FILE, ...files.map((file) => join(OUTPUT_DIRECTORY, file.path))];
  const program = ts.createProgram(
    rootNames.map((rootName) => join(projectDirectory, rootName)),
    compilerOptions(),
  );

  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

function compilerOptions(): ts.CompilerOptions {
  const basePath = new URL("tsconfig.base.json", REPOSITORY_ROOT).pathname;
  const { config } = ts.readConfigFile(basePath, ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, dirname(basePath));

  // The temporary directory has no `@types/node`, and the generated types need none.
  return { ...options, types: [] };
}
