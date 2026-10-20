import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describeError } from "./describe-error.js";
import { isDefinedLintPlugin, type LintPlugin } from "./plugin.js";

// The loader of house plugins for the CLI: each package is resolved from the project that names it, never from
// this package's install, and its default export must be what `defineLintPlugin` returned.

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

    if (isDefinedLintPlugin(exported)) return { plugin: exported };

    return {
      problem: {
        package: packageName,
        message: `The package '${packageName}' has no default export made by defineLintPlugin.`,
        fix: "Point the setting at a seampact lint plugin package; its main module default-exports the value `defineLintPlugin` returns.",
      },
    };
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
