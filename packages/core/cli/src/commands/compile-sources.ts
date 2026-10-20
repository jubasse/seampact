import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type BundleFetchOptions,
  type BundleSourceFailure,
  compileWorkspaceWithImports,
  type Diagnostic,
  fetchBundle,
  finalizeCanonicalIr,
  type LocalSourcePolicy,
  loadFsReader,
  localSourcePolicy,
  localSourceRefusalReason,
  printDiagnostics,
} from "@seampact/compiler";
import type { BundleSource } from "@seampact/spec/config";
import type { ContractIR } from "@seampact/spec/ir";
import type { CliIo } from "../cli-io.js";
import type { CliProblem } from "../cli-problem.js";
import type { LoadedAppConfig } from "../config/index.js";

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

interface SourceRun {
  readonly io: CliIo;
  readonly compiled: CompiledSources;
  readonly localSources: LocalSourcePolicy;
  readonly configDirectory: string;
}

// Each named source, by its kind: a contract workspace directory is compiled (its `workspace.imports` fetched
// first) and the compiler's diagnostics printed on stderr under the source's name; a bundle source is fetched and
// put through the pinned-bundle check, and its IR taken with no compiler run (ADR 0011). A `path` source is refused
// when local sources are (`allowLocal: false`, `SEAMPACT_ALLOW_LOCAL=false`).
export async function compileSources(
  config: Pick<LoadedAppConfig, "file" | "sources" | "allowLocal">,
  names: readonly string[],
  io: CliIo,
): Promise<CompiledSources> {
  const run: SourceRun = {
    io,
    compiled: { failed: false, problems: [], apis: [] },
    localSources: localSourcePolicy(config.allowLocal, process.env),
    configDirectory: dirname(config.file),
  };

  for (const name of names) {
    const source = config.sources.get(name);

    if (source === undefined) throw new Error(`no source named ${name} in the app config`);

    if (source.kind === "bundle") await takeBundle(name, source.bundle, run);
    else await compileSource(name, source.directory, run);
  }

  return run.compiled;
}

async function takeBundle(name: string, bundle: BundleSource, run: SourceRun): Promise<void> {
  const fetched = await fetchBundle(bundle, fetchOptions(run.configDirectory, run));

  if (!fetched.ok) {
    run.compiled.failed = true;
    run.compiled.problems.push(
      ...fetched.failures.map((failure) => bundleProblem(failure, `source '${name}'`)),
    );

    return;
  }

  for (const api of fetched.manifest.apis) {
    const ir = fetched.irs.get(api.name);

    // The check returns the IR of every api its manifest lists.
    if (ir === undefined)
      throw new Error(`the checked bundle of source ${name} has no IR for ${api.name}`);

    run.compiled.apis.push({ source: name, api: api.name, ir });
  }
}

async function compileSource(name: string, directory: string, run: SourceRun): Promise<void> {
  const { compiled, io } = run;

  if (run.localSources === "refuse") {
    compiled.failed = true;
    compiled.problems.push({
      code: "config.source.local",
      message: `The source '${name}' is a local path (${directory}), and local sources are refused here (${localSourceRefusalReason(process.env)}).`,
      fix: "Use a pinned bundle source instead: `{ package, version, integrity }`, `{ release: { url }, integrity }` or `{ git: { url, tag, directory }, integrity }`.",
      where: `source '${name}'`,
    });

    return;
  }

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

  const outcome = await compileWorkspaceWithImports({
    reader: loadFsReader(directory),
    entry: WORKSPACE_ENTRY,
    fetch: fetchOptions(directory, run),
  });

  if (!outcome.ok) {
    compiled.failed = true;
    compiled.problems.push(
      ...outcome.failures.flatMap((each) =>
        each.failures.map((failure) =>
          bundleProblem(failure, `source '${name}', workspace.imports.${each.name}`),
        ),
      ),
    );

    return;
  }

  const result = outcome.compiled;
  const printed = [
    printedDiagnostics(result.diagnostics, result.locations),
    ...result.apis.map((api) => printedDiagnostics(api.diagnostics, api.locations)),
  ].filter((text) => text !== "");

  if (printed.length > 0) io.stderr(`In source '${name}' (${directory}):\n${printed.join("\n")}\n`);

  const diagnostics = [...result.diagnostics, ...result.apis.flatMap((api) => api.diagnostics)];

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) compiled.failed = true;

  for (const api of result.apis) {
    if (api.ir !== undefined)
      compiled.apis.push({ source: name, api: api.api, ir: finalizeCanonicalIr(api.ir) });
  }
}

function fetchOptions(baseDirectory: string, run: SourceRun): BundleFetchOptions {
  return { baseDirectory, localSources: run.localSources };
}

// The failure's file is named when its message does not already hold it.
function bundleProblem(failure: BundleSourceFailure, where: string): CliProblem {
  const file =
    failure.file === undefined || failure.message.includes(failure.file)
      ? ""
      : ` (file '${failure.file}')`;

  return { code: failure.code, message: `${failure.message}${file}`, fix: failure.fix, where };
}

function printedDiagnostics(
  diagnostics: readonly Diagnostic[],
  locations: Parameters<typeof printDiagnostics>[1],
): string {
  return diagnostics.length === 0 ? "" : printDiagnostics(diagnostics, locations);
}
