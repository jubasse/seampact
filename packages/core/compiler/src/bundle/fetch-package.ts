import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { PackageBundleSource } from "@seampact/spec/config";
import { finalizeIsRecord } from "../finalize/record.js";
import { quote } from "../validate/diagnostics.js";
import type { BundleSourceFailure } from "./fetch-failure.js";
import { parseUntrustedJson } from "./untrusted-json.js";

// The npm channel on Node: the package installed in the project, found as Node finds a package, in the
// `node_modules` of the base directory or of a directory above it; the bundle is the package root (its own
// `package.json`, `README*`, `LICENSE*` and `CHANGELOG*` allowed by the check), and its installed version must be
// the one the source names.

const PACKAGE_MANIFEST = "package.json";

/** The installed package's real directory, or the failure naming what is missing or which version is installed. */
export function installedBundlePackage(
  source: PackageBundleSource,
  baseDirectory: string,
): string | BundleSourceFailure {
  const directory = installedPackageDirectory(source.package, baseDirectory);

  if (directory === undefined)
    return {
      code: "bundle.package-missing",
      message: `The bundle package '${source.package}' is not installed in the project of ${baseDirectory}.`,
      fix: `Install it with your package manager, at version ${source.version}.`,
    };

  const version = installedVersion(directory);

  if (version !== source.version)
    return {
      code: "bundle.package-version",
      message: `The installed bundle package '${source.package}' is at version ${version === undefined ? "(none)" : quote(version)}; the source names ${source.version}.`,
      fix: `Install version ${source.version}, or name the installed version in the source and pin its integrity.`,
      file: join(directory, PACKAGE_MANIFEST),
      expected: source.version,
      ...(version === undefined ? {} : { actual: version }),
    };

  return directory;
}

/** The real directory of the package `name` as Node finds it from `baseDirectory`, or undefined when none. */
export function installedPackageDirectory(name: string, baseDirectory: string): string | undefined {
  for (let directory = resolve(baseDirectory); ; directory = dirname(directory)) {
    const candidate = join(directory, "node_modules", ...name.split("/"));

    if (existsSync(join(candidate, PACKAGE_MANIFEST))) return realpathSync(candidate);

    if (dirname(directory) === directory) return undefined;
  }
}

function installedVersion(directory: string): string | undefined {
  const parsed = parseUntrustedJson(readFileSync(join(directory, PACKAGE_MANIFEST), "utf8"));

  if (!parsed.ok || !finalizeIsRecord(parsed.value)) return undefined;

  const version = parsed.value.version;

  return typeof version === "string" ? version : undefined;
}
