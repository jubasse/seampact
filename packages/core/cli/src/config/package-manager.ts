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

const DEV_INSTALL_COMMANDS: Readonly<Record<PackageManager, string>> = {
  pnpm: "pnpm add -D",
  npm: "npm install -D",
  yarn: "yarn add -D",
  bun: "bun add -d",
};

// The command that adds `packageName` as a dev dependency of the project around `directory`.
export function devInstallCommand(directory: string, packageName: string): string {
  return `${DEV_INSTALL_COMMANDS[findPackageManager(directory)]} ${packageName}`;
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
