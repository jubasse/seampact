import { fileURLToPath } from "node:url";
import {
  compileWorkspace,
  type Diagnostic,
  loadFsReader,
  type PipelineApiResult,
  printDiagnostics,
} from "@seampact/compiler";
import type { ContractIR } from "@seampact/spec/ir";
import { expect } from "vitest";
import type { RunLintInput } from "./run-lint.js";
import { runLint } from "./run-lint.js";

// Helpers of the tests: compile a fixture workspace, lint it, print the result.

const FIXTURES = fileURLToPath(new URL("../test/fixtures/", import.meta.url));

export function fixtureDirectory(name: string): string {
  return `${FIXTURES}${name}/`;
}

/** The only api of a fixture workspace, compiled without a diagnostic. */
export function compiledFixtureApi(name: string): PipelineApiResult & { ir: ContractIR } {
  const result = compileWorkspace({
    reader: loadFsReader(fixtureDirectory(name)),
    entry: "workspace.yaml",
    guard: true,
  });
  const [api] = result.apis;

  expect(result.diagnostics).toEqual([]);
  expect(api?.diagnostics).toEqual([]);

  if (api?.ir === undefined) throw new Error(`the ${name} fixture compiled no IR`);

  return { ...api, ir: api.ir };
}

export function lintInputOf(
  api: PipelineApiResult & { ir: ContractIR },
  plugins: RunLintInput["plugins"] = [],
): RunLintInput {
  return { ir: api.ir, declared: api.declared, locations: api.locations, plugins };
}

export function lintedFixtureText(name: string, plugins: RunLintInput["plugins"] = []): string {
  const api = compiledFixtureApi(name);

  return printDiagnostics(runLint(lintInputOf(api, plugins)), api.locations);
}

export function rulesOf(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((diagnostic) => `${diagnostic.severity} ${diagnostic.rule}`);
}
