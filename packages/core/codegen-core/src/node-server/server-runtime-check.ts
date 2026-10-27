import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import type { Refusal } from "../refusal.js";
import { SERVER_RUNTIME_PACKAGE } from "./runtime-files.js";

// The generate-time check of the runtime package (ADR 0025, G2): the runtime the entry's output directory resolves,
// never the copy the target package or the config's directory would resolve, compared with the generator's full
// version. The runtime serves code of its own `major.minor` from a generator at its patch or an earlier one.

/** The rule id of a generate refused because the app does not install the runtime. */
export const RUNTIME_MISSING = "runtime.missing";

/** The rule id of a generate refused because the request does not give the api's output directory to check from. */
export const OUTPUT_DIRECTORY_MISSING = "runtime.output-directory-missing";

/** The rule id of a generate refused because the installed runtime is not one the generator writes for. */
export const RUNTIME_VERSION_MISMATCH = "runtime.version-mismatch";

// The runtime module that holds its version constant and imports nothing, so it loads alone.
const VERSION_MODULE = `${SERVER_RUNTIME_PACKAGE}/version`;
const VERSION_EXPORT = "SERVER_RUNTIME_VERSION";
const NODE_MODULES = "node_modules";
const RELEASE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** The target package that generates, as its refusals name it. */
export interface RuntimeGenerator {
  readonly packageName: string;
  readonly packageVersion: string;
}

/**
 * The refusals of the runtime installed for `outputDirectory`; none when it serves the generator's code. A request
 * without the output directory is refused, never let through unchecked.
 */
export function serverRuntimeRefusals(
  outputDirectory: string | undefined,
  generator: RuntimeGenerator,
): Refusal[] {
  if (outputDirectory === undefined) return [outputDirectoryMissing(generator)];

  const installed = installedRuntimeVersion(outputDirectory);

  if (installed === undefined) return [runtimeMissing(generator)];

  const verdict = runtimeVerdict(installed, generator.packageVersion);

  if (verdict === "serves") return [];

  return [
    verdict === "older-patch"
      ? olderRuntimePatch(installed, generator)
      : otherRuntimeMinor(installed, generator),
  ];
}

// The version constant of the runtime resolved from the output directory, which may not exist yet; undefined when
// no runtime resolves from there. Read afresh at each check, so a long-lived process sees a reinstall.
function installedRuntimeVersion(outputDirectory: string): string | undefined {
  const installRoot = nearestRuntimeInstall(resolve(outputDirectory));

  if (installRoot === undefined) return undefined;

  const versionModule = freshlyLoadedVersionModule(installRoot, outputDirectory);
  const version: unknown =
    typeof versionModule === "object" && versionModule !== null
      ? Reflect.get(versionModule, VERSION_EXPORT)
      : undefined;

  if (typeof version !== "string") {
    throw new Error(
      `${VERSION_MODULE}, resolved from ${outputDirectory}, exports no ${VERSION_EXPORT} string; reinstall ${SERVER_RUNTIME_PACKAGE}.`,
    );
  }

  return version;
}

function freshlyLoadedVersionModule(installRoot: string, outputDirectory: string): unknown {
  const requireFromInstall = createRequire(join(installRoot, sep));
  let versionFile: string;

  try {
    versionFile = requireFromInstall.resolve(VERSION_MODULE);
  } catch (failure) {
    throw new Error(
      `${VERSION_MODULE} does not resolve from ${outputDirectory} (${String(failure)}); reinstall ${SERVER_RUNTIME_PACKAGE}.`,
    );
  }

  Reflect.deleteProperty(requireFromInstall.cache, versionFile);

  return requireFromInstall(versionFile);
}

// The nearest directory, from `directory` up, whose `node_modules` holds the runtime: Node's own lookup without the
// `NODE_PATH` and global folders, which a package manager's bin shim may point at another install.
function nearestRuntimeInstall(directory: string): string | undefined {
  const installed = join(NODE_MODULES, ...SERVER_RUNTIME_PACKAGE.split("/"));

  for (let current = directory; ; current = dirname(current)) {
    if (existsSync(join(current, installed))) return current;

    if (dirname(current) === current) return undefined;
  }
}

type RuntimeVerdict = "serves" | "other-minor" | "older-patch";

// The same version serves; otherwise both are release versions of one `major.minor` and the runtime's patch is at
// or above the generator's. A prerelease version serves only itself.
function runtimeVerdict(installedVersion: string, generatorVersion: string): RuntimeVerdict {
  if (installedVersion === generatorVersion) return "serves";

  const installed = RELEASE_VERSION.exec(installedVersion);
  const generator = RELEASE_VERSION.exec(generatorVersion);

  if (installed === null || generator === null) return "other-minor";

  if (installed[1] !== generator[1] || installed[2] !== generator[2]) return "other-minor";

  return Number(installed[3]) >= Number(generator[3]) ? "serves" : "older-patch";
}

function installLine(version: string): string {
  return `\`npm install ${SERVER_RUNTIME_PACKAGE}@${version}\``;
}

function outputDirectoryMissing(generator: RuntimeGenerator): Refusal {
  return {
    code: OUTPUT_DIRECTORY_MISSING,
    message: `\`${generator.packageName} ${generator.packageVersion}\` generates code that imports \`${SERVER_RUNTIME_PACKAGE}\` and checks the installed one from the api's output directory, which this generate request does not give (\`outputDirectory\`).`,
    fix: "Pass the api's output directory as `outputDirectory` in the generate request, as `seampact generate` does.",
  };
}

function runtimeMissing(generator: RuntimeGenerator): Refusal {
  return {
    code: RUNTIME_MISSING,
    message: `\`${generator.packageName} ${generator.packageVersion}\` generates code that imports \`${SERVER_RUNTIME_PACKAGE}\`, which this app does not install.`,
    fix: `Install it as a production dependency at the generator's version: ${installLine(generator.packageVersion)}.`,
  };
}

function otherRuntimeMinor(installed: string, generator: RuntimeGenerator): Refusal {
  const release = RELEASE_VERSION.exec(generator.packageVersion);
  const writtenFor = release === null ? generator.packageVersion : `${release[1]}.${release[2]}.x`;

  return {
    code: RUNTIME_VERSION_MISMATCH,
    message: `\`${SERVER_RUNTIME_PACKAGE} ${installed}\` is installed, \`${generator.packageName} ${generator.packageVersion}\` generates for \`${writtenFor}\`.`,
    fix: `Install the runtime at the generator's version (${installLine(generator.packageVersion)}), or move the generator to the runtime's version, \`${installed}\`.`,
  };
}

function olderRuntimePatch(installed: string, generator: RuntimeGenerator): Refusal {
  return {
    code: RUNTIME_VERSION_MISMATCH,
    message: `\`${SERVER_RUNTIME_PACKAGE} ${installed}\` is older than the generator, \`${generator.packageName} ${generator.packageVersion}\`.`,
    fix: `Install the runtime at \`${generator.packageVersion}\` or a later patch: ${installLine(generator.packageVersion)}.`,
  };
}
