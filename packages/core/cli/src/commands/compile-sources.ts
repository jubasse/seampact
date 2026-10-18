import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  compileWorkspace,
  type Diagnostic,
  loadFsReader,
  printDiagnostics,
} from "@seampact/compiler";
import type { ContractIR } from "@seampact/spec/ir";
import type { CliProblem } from "../cli-problem.js";
import type { CliIo } from "../cli-io.js";

const WORKSPACE_ENTRY = "workspace.yaml";

export interface CompiledApi {
  source: string;
  api: string;
  ir: ContractIR;
}

export interface CompiledSources {
  // True when a source reported an error: its diagnostics are printed and nothing may be generated.
  failed: boolean;
  problems: CliProblem[];
  apis: CompiledApi[];
}

// Compiles each named source, a contract workspace directory, and prints the compiler's diagnostics on stderr
// under the source's name.
export function compileSources(
  sources: ReadonlyMap<string, string>,
  names: readonly string[],
  io: CliIo,
): CompiledSources {
  const compiled: CompiledSources = { failed: false, problems: [], apis: [] };

  for (const name of names) {
    const directory = sources.get(name);

    if (directory === undefined) throw new Error(`no source named ${name} in the app config`);

    compileSource(name, directory, io, compiled);
  }

  return compiled;
}

function compileSource(
  name: string,
  directory: string,
  io: CliIo,
  compiled: CompiledSources,
): void {
  if (!existsSync(join(directory, WORKSPACE_ENTRY))) {
    compiled.failed = true;
    compiled.problems.push({
      code: "config.source.no-workspace",
      message: `The source '${name}' (${directory}) holds no \`${WORKSPACE_ENTRY}\`.`,
      fix: `Point the source's \`path\` at a contract workspace directory, the one holding \`${WORKSPACE_ENTRY}\`.`,
      where: `source '${name}'`,
    });

    return;
  }

  const result = compileWorkspace({ reader: loadFsReader(directory), entry: WORKSPACE_ENTRY });
  const printed = [
    printedDiagnostics(result.diagnostics, result.locations),
    ...result.apis.map((api) => printedDiagnostics(api.diagnostics, api.locations)),
  ].filter((text) => text !== "");

  if (printed.length > 0) io.stderr(`In source '${name}' (${directory}):\n${printed.join("\n")}\n`);

  const diagnostics = [...result.diagnostics, ...result.apis.flatMap((api) => api.diagnostics)];

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) compiled.failed = true;

  for (const api of result.apis) {
    if (api.ir !== undefined) compiled.apis.push({ source: name, api: api.api, ir: api.ir });
  }
}

function printedDiagnostics(
  diagnostics: readonly Diagnostic[],
  locations: Parameters<typeof printDiagnostics>[1],
): string {
  return diagnostics.length === 0 ? "" : printDiagnostics(diagnostics, locations);
}
