import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describeError } from "./describe-error.js";
import {
  isDefinedLintPlugin,
  LINT_PLUGIN_API_VERSION,
  type LintPlugin,
  lintAssertPlugin,
  lintPluginApiVersion,
} from "./plugin.js";

// The loader of house plugins for the CLI: each package is resolved from the project that names it, never from
// this package's install, and its default export must be what `defineLintPlugin` returned: branded with this
// plugin API version, and checked again as `defineLintPlugin` checks it, since a brand can be written by hand.

export interface LintPluginProblem {
  /** The package name as written. */
  package: string;
  message: string;
  fix: string;
}

export type LoadLintPluginsOutcome =
  | { status: "loaded"; plugins: LintPlugin[] }
  | { status: "refused"; problems: LintPluginProblem[] };

const RESOLVE_ANCHOR = "lint-plugins.js";

/** Loads the plugin packages `packageNames` name, resolved from `fromDirectory`; every failure is reported. */
export async function loadLintPlugins(
  packageNames: readonly string[],
  fromDirectory: string,
): Promise<LoadLintPluginsOutcome> {
  const plugins: LintPlugin[] = [];
  const problems: LintPluginProblem[] = [];

  for (const packageName of packageNames) {
    const loaded = await loadOne(packageName, fromDirectory);

    if ("problem" in loaded) problems.push(loaded.problem);
    else plugins.push(loaded.plugin);
  }

  return problems.length > 0 ? { status: "refused", problems } : { status: "loaded", plugins };
}

async function loadOne(
  packageName: string,
  fromDirectory: string,
): Promise<{ plugin: LintPlugin } | { problem: LintPluginProblem }> {
  const resolved = resolveFrom(packageName, fromDirectory);

  if ("problem" in resolved) return resolved;

  try {
    const module: unknown = await import(pathToFileURL(resolved.file).href);
    const exported =
      typeof module === "object" && module !== null ? Reflect.get(module, "default") : undefined;

    return checkedPlugin(packageName, exported);
  } catch (error) {
    return {
      problem: {
        package: packageName,
        message: `The lint plugin package '${packageName}' failed to load: ${describeError(error)}`,
        fix: "Reinstall the package, or check that its version matches this CLI.",
      },
    };
  }
}

function checkedPlugin(
  packageName: string,
  exported: unknown,
): { plugin: LintPlugin } | { problem: LintPluginProblem } {
  if (!isDefinedLintPlugin(exported))
    return {
      problem: {
        package: packageName,
        message: `The package '${packageName}' has no default export made by defineLintPlugin.`,
        fix: "Point the setting at a seampact lint plugin package; its main module default-exports the value `defineLintPlugin` returns.",
      },
    };

  if (lintPluginApiVersion(exported) !== LINT_PLUGIN_API_VERSION)
    return {
      problem: {
        package: packageName,
        message: `The lint plugin package '${packageName}' was built against another lint plugin API than version ${LINT_PLUGIN_API_VERSION}.`,
        fix: "Rebuild the plugin against this CLI: update its @seampact/lint dependency and publish it again.",
      },
    };

  try {
    lintAssertPlugin(exported);
  } catch (error) {
    return {
      problem: {
        package: packageName,
        message: `The lint plugin package '${packageName}' exports an invalid plugin: ${describeError(error)}`,
        fix: "Build the plugin with defineLintPlugin and fix what the message names.",
      },
    };
  }

  return { plugin: exported };
}

function resolveFrom(
  packageName: string,
  fromDirectory: string,
): { file: string } | { problem: LintPluginProblem } {
  try {
    return { file: createRequire(join(fromDirectory, RESOLVE_ANCHOR)).resolve(packageName) };
  } catch (error) {
    const missing = error instanceof Error && Reflect.get(error, "code") === "MODULE_NOT_FOUND";

    return {
      problem: {
        package: packageName,
        message: missing
          ? `The lint plugin package '${packageName}' is not installed in the project.`
          : `The lint plugin package '${packageName}' cannot be resolved: ${describeError(error)}`,
        fix: missing
          ? `Install it: \`pnpm add -D ${packageName}\`.`
          : "Fix the package's `exports` so a `require` or `default` condition names its main module.",
      },
    };
  }
}
