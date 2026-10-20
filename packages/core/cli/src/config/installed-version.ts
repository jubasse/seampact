import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { CliProblem } from "../cli-problem.js";
import { isRecord } from "../is-record.js";
import { installFix } from "./package-manager.js";

// The version of a framework or validator library package installed in a project, read from its `package.json` in
// the `node_modules` directories from a lookup directory up, as Node's ESM resolution searches them (it reads no
// global folder). The file is read directly, not resolved, since a package's `exports` may hide its `package.json`.

export interface InstalledVersion {
  packageName: string;
  version: string;
  // A pre-release counts as its major: `6.0.0-beta.1` is 6.
  major: number;
}

export type InstalledVersionOutcome =
  | { status: "installed"; installed: InstalledVersion }
  | { status: "refused"; problem: CliProblem };

/** What the generated code imports the package as, which the problems name it by. */
export type InstalledPackageRole = "framework" | "validatorLibrary";

const ROLE_LABELS: Readonly<Record<InstalledPackageRole, string>> = {
  framework: "framework package",
  validatorLibrary: "validator library",
};

/** The code of the problem for a package that is not installed in the project. */
export const FRAMEWORK_MISSING_CODE = "config.matrix.framework-missing";

const MAJOR_PATTERN = /^v?(0|[1-9][0-9]*)\./;

const NODE_MODULES = "node_modules";

const PNP_FILES: readonly string[] = [".pnp.cjs", ".pnp.js"];

export function readInstalledVersion(
  lookupDirectory: string,
  packageName: string,
  role: InstalledPackageRole,
  where: string,
): InstalledVersionOutcome {
  const packageJsonFile = findPackageJson(lookupDirectory, packageName);

  if (packageJsonFile === undefined) {
    return {
      status: "refused",
      problem: missingPackageProblem(lookupDirectory, packageName, role, where),
    };
  }

  const declared = declaredMajor(packageJsonFile);

  if (declared.status === "unreadable") {
    return {
      status: "refused",
      problem: {
        code: "config.matrix.version-unreadable",
        message: `The installed ${ROLE_LABELS[role]} '${packageName}' has no version the CLI can read: ${declared.reason}`,
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

function findPackageJson(lookupDirectory: string, packageName: string): string | undefined {
  return ancestorsOf(lookupDirectory)
    .filter((directory) => basename(directory) !== NODE_MODULES)
    .map((directory) => join(directory, NODE_MODULES, packageName, "package.json"))
    .find((file) => existsSync(file));
}

// A Plug'n'Play install has no `node_modules`, so a missing package there is the install mode, not the package.
function missingPackageProblem(
  lookupDirectory: string,
  packageName: string,
  role: InstalledPackageRole,
  where: string,
): CliProblem {
  const pnpFile = ancestorsOf(lookupDirectory)
    .flatMap((directory) => PNP_FILES.map((file) => join(directory, file)))
    .find((file) => existsSync(file));

  if (pnpFile !== undefined) {
    return {
      code: "config.matrix.pnp-unsupported",
      message: `The project around ${lookupDirectory} installs its packages with Yarn Plug'n'Play (${pnpFile}), which the CLI cannot read the version of '${packageName}' from.`,
      fix: "Set `nodeLinker: node-modules` in the project's `.yarnrc.yml`, then run `yarn install`.",
      where,
    };
  }

  return {
    code: FRAMEWORK_MISSING_CODE,
    message: `The ${ROLE_LABELS[role]} '${packageName}' is not installed in the project of the entry's output directory (${lookupDirectory}), so its version cannot be checked against the compatibility matrix; the generated code imports it.`,
    fix: installFix(lookupDirectory, packageName, "runtime"),
    where,
  };
}

function ancestorsOf(directory: string): string[] {
  const parent = dirname(directory);

  return parent === directory ? [directory] : [directory, ...ancestorsOf(parent)];
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
