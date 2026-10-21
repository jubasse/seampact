import { resolve } from "node:path";
import { type BundleOutput, loadFsReader, writeBundle } from "@seampact/compiler";
import type { BundleNamedVersion } from "@seampact/spec/bundle";
import { type CliIo, EXIT_REFUSED, EXIT_SUCCESS, printProblems } from "../cli-io.js";
import type { CliProblem } from "../cli-problem.js";
import { type LoadedAppConfig, readAppConfig } from "../config/index.js";
import { bundleProblem, noWorkspaceProblem, printSourceDiagnostics } from "./compile-sources.js";
import type { ConfigLocation } from "./config-location.js";
import { sourceEntryFile } from "./workspace-api-names.js";

export interface BundleCommandOptions {
  // The `path` source to bundle; the app config's only `path` source when absent.
  readonly source?: string;
  // The output path, relative to the working directory, with the form `writeBundle` writes.
  readonly output: BundleOutput;
  // The contract's name and version, over the workspace root `package.json`.
  readonly contract: Partial<BundleNamedVersion>;
}

interface BundledSource {
  readonly name: string;
  readonly directory: string;
}

type SourceChoice =
  | { readonly status: "chosen"; readonly source: BundledSource }
  | { readonly status: "refused"; readonly problem: CliProblem };

// `seampact bundle`: compiles a `path` source of the app config and writes its bundle (ADR 0011 "The bundle") as a
// directory, an npm package directory or a reproducible tarball, then prints the integrity value a consumer pins.
export async function bundleCommand(
  location: ConfigLocation,
  options: BundleCommandOptions,
  io: CliIo,
): Promise<number> {
  const read = await readAppConfig(location.file, location.displayName);

  if (read.status === "refused") return refuse(io, read.problems);

  const choice = chosenSource(read.config, options.source);

  if (choice.status === "refused") return refuse(io, [choice.problem]);

  const { name, directory } = choice.source;
  const entry = sourceEntryFile(directory);

  if (entry === undefined) return refuse(io, [noWorkspaceProblem(name, directory)]);

  const output = resolvedOutput(io.cwd, options.output);
  const written = writeBundle({
    reader: (io.sourceReader ?? loadFsReader)(directory),
    entry,
    contract: options.contract,
    output,
  });

  if (!written.ok) {
    if (written.compiled !== undefined) printSourceDiagnostics(io, choice.source, written.compiled);

    return refuse(
      io,
      written.failures.map((failure) => bundleProblem(failure, `source '${name}'`)),
    );
  }

  printSourceDiagnostics(io, choice.source, written.compiled);

  const { contract, apis, integrity } = written.manifest;

  io.stdout(
    `Wrote the bundle of ${contract.name}@${contract.version} (${apis.map((api) => api.name).join(", ")}) to ${outputPath(output)}.\nintegrity: ${integrity}\n`,
  );

  return EXIT_SUCCESS;
}

function chosenSource(config: LoadedAppConfig, named: string | undefined): SourceChoice {
  const pathSources = [...config.sources].flatMap(([name, source]) =>
    source.kind === "path" ? [{ name, directory: source.directory }] : [],
  );

  if (named !== undefined) return namedSource(config, named, pathSources);

  const [only] = pathSources;

  if (only !== undefined && pathSources.length === 1) return { status: "chosen", source: only };

  if (only === undefined)
    return {
      status: "refused",
      problem: {
        code: "bundle.source.none",
        message: "The app config has no `path` source, so there is no workspace to bundle.",
        fix: "Add the contract directory under `sources` as `{ path: <dir> }`.",
      },
    };

  return {
    status: "refused",
    problem: {
      code: "bundle.source.ambiguous",
      message: `The app config has several \`path\` sources (${pathSources.map((each) => `'${each.name}'`).join(", ")}).`,
      fix: "Name the one to bundle with `--source <name>`.",
    },
  };
}

function namedSource(
  config: LoadedAppConfig,
  named: string,
  pathSources: readonly BundledSource[],
): SourceChoice {
  const found = pathSources.find((each) => each.name === named);

  if (found !== undefined) return { status: "chosen", source: found };

  if (config.sources.has(named))
    return {
      status: "refused",
      problem: {
        code: "bundle.source.not-local",
        message: `The source '${named}' is a bundle source; only a \`path\` source holds a workspace to bundle.`,
        fix: "Name a `path` source with `--source`, or bundle in the repository that holds that contract.",
      },
    };

  return {
    status: "refused",
    problem: {
      code: "bundle.source.unknown",
      message: `The app config has no source '${named}' (${[...config.sources.keys()].join(", ") || "none"}).`,
      fix: "Name one of the app config's `path` sources with `--source`.",
    },
  };
}

function resolvedOutput(cwd: string, output: BundleOutput): BundleOutput {
  if ("directory" in output) return { directory: resolve(cwd, output.directory) };

  if ("npmPackage" in output) return { npmPackage: resolve(cwd, output.npmPackage) };

  return { tarball: resolve(cwd, output.tarball) };
}

function outputPath(output: BundleOutput): string {
  if ("directory" in output) return output.directory;

  return "npmPackage" in output ? output.npmPackage : output.tarball;
}

function refuse(io: CliIo, problems: readonly CliProblem[]): number {
  printProblems(io, problems);

  return EXIT_REFUSED;
}
