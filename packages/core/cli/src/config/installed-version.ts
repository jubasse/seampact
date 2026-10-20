import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { CliProblem } from "../cli-problem.js";
import { isRecord } from "../is-record.js";
import { installFix } from "./package-manager.js";

// The version of a framework package installed in the app's project, read from its `package.json` found through
// Node's lookup paths from the config file's directory. The file is read directly, not resolved, since a package's
// `exports` may hide its `package.json`.

export interface InstalledVersion {
  packageName: string;
  version: string;
  // A pre-release counts as its major: `6.0.0-beta.1` is 6.
  major: number;
}

export type InstalledVersionOutcome =
  | { status: "installed"; installed: InstalledVersion }
  | { status: "refused"; problem: CliProblem };

const MAJOR_PATTERN = /^v?(0|[1-9][0-9]*)\./;

export function readInstalledVersion(
  configFile: string,
  packageName: string,
  where: string,
): InstalledVersionOutcome {
  const packageJsonFile = findPackageJson(configFile, packageName);

  if (packageJsonFile === undefined) {
    return {
      status: "refused",
      problem: {
        code: "config.matrix.framework-missing",
        message: `The framework package '${packageName}' is not installed in the app's project, so its version cannot be checked against the compatibility matrix; the generated code imports it.`,
        fix: installFix(configFile, packageName, "runtime"),
        where,
      },
    };
  }

  const declared = declaredMajor(packageJsonFile);

  if (declared.status === "unreadable") {
    return {
      status: "refused",
      problem: {
        code: "config.matrix.version-unreadable",
        message: `The installed framework package '${packageName}' has no version the CLI can read: ${declared.reason}`,
        fix: `Reinstall '${packageName}' with your package manager.`,
        where,
      },
    };
  }

  return {
    status: "installed",
    installed: { packageName, version: declared.version, major: declared.major },
  };
}

function findPackageJson(configFile: string, packageName: string): string | undefined {
  const lookupDirectories = createRequire(configFile).resolve.paths(packageName) ?? [];

  return lookupDirectories
    .map((directory) => join(directory, packageName, "package.json"))
    .find((file) => existsSync(file));
}

type DeclaredMajor =
  | { status: "read"; version: string; major: number }
  | { status: "unreadable"; reason: string };

function declaredMajor(packageJsonFile: string): DeclaredMajor {
  const parsed = parsedPackageJson(packageJsonFile);

  if (parsed.status === "unreadable") return parsed;

  const version = isRecord(parsed.value) ? parsed.value.version : undefined;
  const major = typeof version === "string" ? MAJOR_PATTERN.exec(version)?.[1] : undefined;

  if (typeof version !== "string" || major === undefined) {
    return {
      status: "unreadable",
      reason: `${packageJsonFile} declares no \`version\` of the form <major>.<minor>.<patch>.`,
    };
  }

  return { status: "read", version, major: Number(major) };
}

function parsedPackageJson(
  packageJsonFile: string,
): { status: "parsed"; value: unknown } | { status: "unreadable"; reason: string } {
  try {
    return { status: "parsed", value: JSON.parse(readFileSync(packageJsonFile, "utf8")) };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;

    return {
      status: "unreadable",
      reason: `${packageJsonFile} is not valid JSON (${error.message}).`,
    };
  }
}
