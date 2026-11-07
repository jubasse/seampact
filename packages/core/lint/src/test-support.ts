import { fileURLToPath } from "node:url";
import {
  compileWorkspace,
  type Diagnostic,
  loadFsReader,
  type PipelineApiResult,
  type PipelineDeclared,
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

type CompiledApi = PipelineApiResult & { ir: ContractIR; declared: readonly PipelineDeclared[] };

/** The only api of a fixture workspace, compiled without a diagnostic. */
export function compiledFixtureApi(name: string): CompiledApi {
  const result = compileWorkspace({
    reader: loadFsReader(fixtureDirectory(name)),
    entry: "workspace.yaml",
    guard: true,
  });
  const [api] = result.apis;

  expect(result.diagnostics).toEqual([]);
  expect(api?.diagnostics).toEqual([]);

  if (api?.ir === undefined || api.declared === undefined)
    throw new Error(`the ${name} fixture compiled no IR`);

  return { ...api, ir: api.ir, declared: api.declared };
}

/** Every api of a workspace directory outside the fixtures, linted by the core rules, with its diagnostics. */
export async function lintedWorkspaceApis(
  directory: string,
): Promise<{ api: string; diagnostics: Diagnostic[] }[]> {
  const result = compileWorkspace({ reader: loadFsReader(directory), entry: "workspace.yaml" });
  const linted: { api: string; diagnostics: Diagnostic[] }[] = [];

  expect(result.diagnostics).toEqual([]);

  for (const api of result.apis) {
    expect(api.diagnostics).toEqual([]);

    if (api.ir === undefined || api.declared === undefined)
      throw new Error(`the api ${api.api} of ${directory} compiled no IR`);
    const compiled = { ...api, ir: api.ir, declared: api.declared };

    linted.push({ api: api.api, diagnostics: await runLint(lintInputOf(compiled)) });
  }

  return linted;
}

export function lintInputOf(api: CompiledApi, plugins: RunLintInput["plugins"] = []): RunLintInput {
  return { ir: api.ir, declared: api.declared, locations: api.locations, plugins };
}

export async function lintedFixtureText(
  name: string,
  plugins: RunLintInput["plugins"] = [],
): Promise<string> {
  const api = compiledFixtureApi(name);

  return printDiagnostics(await runLint(lintInputOf(api, plugins)), api.locations);
}

export function rulesOf(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((diagnostic) => `${diagnostic.severity} ${diagnostic.rule}`);
}
