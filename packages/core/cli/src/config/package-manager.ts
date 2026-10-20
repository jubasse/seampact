import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isRecord } from "../is-record.js";

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

// The lockfile each package manager writes, checked in this order in each directory.
const LOCKFILES: readonly { file: string; manager: PackageManager }[] = [
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "bun.lock", manager: "bun" },
  { file: "bun.lockb", manager: "bun" },
  { file: "package-lock.json", manager: "npm" },
];

// A target package is a dev dependency (it runs at generate time); a framework the generated code imports is a
// runtime one.
export type DependencyKind = "dev" | "runtime";

const INSTALL_COMMANDS: Readonly<Record<DependencyKind, Readonly<Record<PackageManager, string>>>> =
  {
    dev: { pnpm: "pnpm add -D", npm: "npm install -D", yarn: "yarn add -D", bun: "bun add -d" },
    runtime: { pnpm: "pnpm add", npm: "npm install", yarn: "yarn add", bun: "bun add" },
  };

// The command that adds `packageName` as a dependency of that kind to the project around `directory`.
export function installCommand(
  directory: string,
  packageName: string,
  kind: DependencyKind,
): string {
  return `${INSTALL_COMMANDS[kind][findPackageManager(directory)]} ${packageName}`;
}

// The fix of a package missing from the app's project: its install command, or why none could be told.
export function installFix(configFile: string, packageName: string, kind: DependencyKind): string {
  try {
    return `Install it: \`${installCommand(dirname(configFile), packageName, kind)}\`.`;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;

    return `Install it with your package manager; a \`package.json\` above the config is not valid JSON (${error.message}).`;
  }
}

// The package manager of the nearest directory, from `directory` up, with a lockfile or a `packageManager` field
// in its `package.json`; npm when none has either.
export function findPackageManager(directory: string): PackageManager {
  for (let current = directory; ; current = dirname(current)) {
    const found = packageManagerIn(current);

    if (found !== undefined) return found;

    if (dirname(current) === current) return "npm";
  }
}

function packageManagerIn(directory: string): PackageManager | undefined {
  const lockfile = LOCKFILES.find(({ file }) => existsSync(join(directory, file)));

  if (lockfile !== undefined) return lockfile.manager;

  return declaredPackageManager(join(directory, "package.json"));
}

function declaredPackageManager(packageJsonFile: string): PackageManager | undefined {
  if (!existsSync(packageJsonFile)) return undefined;

  const packageJson: unknown = JSON.parse(readFileSync(packageJsonFile, "utf8"));

  if (!isRecord(packageJson) || typeof packageJson.packageManager !== "string") return undefined;

  const name = packageJson.packageManager.split("@")[0];

  return LOCKFILES.map(({ manager }) => manager).find((manager) => manager === name);
}
