import { type Diagnostic, printDiagnostics } from "@seampact/compiler";
import { runLint } from "@seampact/lint";
import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS, printProblems } from "../cli-io.js";
import { readAppConfig } from "../config/index.js";
import { compileSources } from "./compile-sources.js";
import type { ConfigLocation } from "./config-location.js";

// `seampact lint`: compiles each `path` source of the app config and runs the core lint rules over each api, with
// the `lint.rules` and `lint.allow` the contract sets (ADR 0006 section 4). A bundle source holds a compiled IR, not
// the contract the rules read, so it is named and left out. Exit code 1 when a source does not compile or a rule
// reports an error.
export async function lintCommand(location: ConfigLocation, io: CliIo): Promise<number> {
  const read = await readAppConfig(location.file, location.displayName);

  if (read.status === "refused") return refuse(io, read.problems);

  const { config } = read;
  const sources = [...config.sources].map(([name, source]) => ({ name, kind: source.kind }));
  const pathSources = sources.filter(({ kind }) => kind !== "bundle").map(({ name }) => name);

  for (const { name } of sources.filter(({ kind }) => kind === "bundle")) {
    io.stdout(
      `Skipped the bundle source '${name}': it holds a compiled IR, and lint reads the contract.\n`,
    );
  }

  if (pathSources.length === 0) {
    return refuse(io, [
      {
        code: "lint.no-source",
        message: "The app config has no `path` source whose contract could be linted.",
        fix: "Add a source `{ path: <contract workspace directory> }` to `sources`.",
      },
    ]);
  }

  const compiled = await compileSources(config, pathSources, io);

  if (compiled.failed) return refuse(io, compiled.problems);

  let errors = 0;
  let warnings = 0;

  for (const { source, api, ir, lintInput } of compiled.apis) {
    if (lintInput === undefined)
      throw new Error(`the compiled api ${source}/${api} has no lint input`);

    const diagnostics = await runLint({ ir, ...lintInput, plugins: [] });

    errors += diagnostics.filter(isError).length;
    warnings += diagnostics.length - diagnostics.filter(isError).length;

    if (diagnostics.length > 0) {
      io.stderr(
        `In source '${source}', api '${api}':\n${printDiagnostics(diagnostics, lintInput.locations)}\n`,
      );
    }
  }

  io.stdout(`Linted ${compiled.apis.length} api(s): ${errors} error(s), ${warnings} warning(s).\n`);

  return errors > 0 ? EXIT_REFUSED : EXIT_SUCCESS;
}

function isError(diagnostic: Diagnostic): boolean {
  return diagnostic.severity === "error";
}

function refuse(io: CliIo, problems: Parameters<typeof printProblems>[1]): number {
  printProblems(io, problems);

  return EXIT_REFUSED;
}
