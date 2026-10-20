import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { TARGET_ROLES, type Target } from "@seampact/codegen-core";
import type { CliProblem } from "../cli-problem.js";
import { errorCode } from "../error-code.js";
import { isRecord } from "../is-record.js";
import { devInstallCommand } from "./package-manager.js";

export type ResolveTargetOutcome =
  | { status: "resolved"; target: Target }
  | { status: "refused"; problem: CliProblem };

// Loads the target package `use` names from the app's own project, starting at the config file's directory and
// never at the CLI's install (ADR 0009 "Target resolution from the app config"). The package's main module exports
// the value `defineTarget` returns under the name `target`.
export async function resolveTarget(
  configFile: string,
  use: string,
  where: string,
): Promise<ResolveTargetOutcome> {
  const resolved = resolveFromConfig(configFile, use, where);

  if (typeof resolved !== "string") return { status: "refused", problem: resolved };

  const loaded = await importTargetModule(resolved, use, where);

  if (loaded.status === "refused") return loaded;

  const exported = isRecord(loaded.module) ? loaded.module.target : undefined;

  if (!isTarget(exported)) {
    return {
      status: "refused",
      problem: {
        code: "config.target.not-a-target",
        message: `The package '${use}' has no export named \`target\` holding a seampact target.`,
        fix: "Point `use` at a seampact target package; its main module exports `target`, the value `defineTarget` returns.",
        where,
      },
    };
  }

  if (!TARGET_ROLES.some((role) => role === exported.metadata.role)) {
    return {
      status: "refused",
      problem: {
        code: "config.target.role-missing",
        message: `The target package '${use}' declares no \`metadata.role\` among ${TARGET_ROLES.join(", ")}.`,
        fix: "Install a version of the target built for this CLI, or ask its maintainers to declare its role.",
        where,
      },
    };
  }

  return { status: "resolved", target: exported };
}

function resolveFromConfig(configFile: string, use: string, where: string): string | CliProblem {
  try {
    return createRequire(configFile).resolve(use);
  } catch (error) {
    if (errorCode(error) === "MODULE_NOT_FOUND") {
      return {
        code: "config.target.missing",
        message: `The target package '${use}' is not installed in the app's project.`,
        fix: installFix(configFile, use),
        where,
      };
    }

    if (errorCode(error) === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
      return {
        code: "config.target.unresolvable",
        message: `The package '${use}' exports no main module the CLI can resolve: ${errorMessage(error)}`,
        fix: "The CLI loads a target with the `require` conditions: use a target package whose `exports` has a `.` entry with a `require` or `default` condition.",
        where,
      };
    }

    if (errorCode(error) === "ERR_INVALID_PACKAGE_CONFIG") {
      return {
        code: "config.target.unresolvable",
        message: `Resolving '${use}' failed on a \`package.json\` Node cannot read: ${errorMessage(error)}`,
        fix: "Fix the `package.json` the message names (the app's or the target package's), or reinstall the package.",
        where,
      };
    }

    throw error;
  }
}

function installFix(configFile: string, use: string): string {
  try {
    return `Install it: \`${devInstallCommand(dirname(configFile), use)}\`.`;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;

    return `Install it with your package manager; a \`package.json\` above the config is not valid JSON (${error.message}).`;
  }
}

async function importTargetModule(
  file: string,
  use: string,
  where: string,
): Promise<{ status: "loaded"; module: unknown } | { status: "refused"; problem: CliProblem }> {
  try {
    const module: unknown = await import(pathToFileURL(file).href);

    return { status: "loaded", module };
  } catch (error) {
    return {
      status: "refused",
      problem: {
        code: "config.target.load-failed",
        message: `The target package '${use}' failed to load: ${errorMessage(error)}`,
        fix: "Reinstall the package, or check that its version matches this CLI.",
        where,
      },
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The members the CLI calls, checked at run time since the module comes from the app's project.
function isTarget(value: unknown): value is Target {
  if (!isRecord(value) || !isRecord(value.metadata)) return false;

  const { metadata } = value;

  return (
    typeof value.parseOptions === "function" &&
    typeof value.generate === "function" &&
    typeof value.describe === "function" &&
    typeof metadata.packageName === "string" &&
    typeof metadata.packageVersion === "string" &&
    isRecord(metadata.irSupport) &&
    isRecord(metadata.consumes) &&
    isRecord(metadata.provides) &&
    Array.isArray(metadata.artefacts) &&
    metadata.artefacts.every(isArtefactDeclaration)
  );
}

function isArtefactDeclaration(value: unknown): boolean {
  return isRecord(value) && typeof value.id === "string" && typeof value.defaultOn === "boolean";
}
