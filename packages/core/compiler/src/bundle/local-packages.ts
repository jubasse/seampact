import { existsSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { finalizeIsRecord } from "../finalize/record.js";
import { installedPackageDirectory } from "./fetch-package.js";
import { parseUntrustedJson } from "./untrusted-json.js";

// The `package` sources the package manager resolved from a local path, which `check` refuses on shared branches
// (ADR 0011 "Refusing local sources on shared branches"): the app's `package.json` names the package with a
// `file:`, `link:`, `workspace:` or `portal:` spec or a path, or the installed package's real path lies outside
// every `node_modules` (a workspace link).

export interface LocalPackageSource {
  readonly package: string;
  /** Why it is local: the spec the app's `package.json` gives, or the real path it is installed at. */
  readonly reason: { readonly spec: string } | { readonly realPath: string };
}

const PACKAGE_MANIFEST = "package.json";
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;
const LOCAL_PROTOCOL_SPEC = /^(?:file|link|workspace|portal):/u;
const PATH_SPEC = /^(?:\.{1,2}(?:[\\/]|$)|[\\/]|~[\\/]|[A-Za-z]:[\\/])/u;
const NODE_MODULES = "node_modules";

/** Each of `packages` that the app at `appDirectory` installs from a local path, in the order given. */
export function findLocalPackageSources(
  appDirectory: string,
  packages: readonly string[],
): LocalPackageSource[] {
  const specs = dependencySpecs(appDirectory);
  const found: LocalPackageSource[] = [];

  for (const name of packages) {
    const spec = specs.get(name);

    if (spec !== undefined && (LOCAL_PROTOCOL_SPEC.test(spec) || PATH_SPEC.test(spec))) {
      found.push({ package: name, reason: { spec } });
      continue;
    }

    const realPath = installedPackageDirectory(name, appDirectory);

    if (realPath !== undefined && !realPath.split(sep).includes(NODE_MODULES))
      found.push({ package: name, reason: { realPath } });
  }

  return found;
}

// Each dependency's spec in the app's `package.json`; none when it has none.
function dependencySpecs(appDirectory: string): Map<string, string> {
  const file = join(appDirectory, PACKAGE_MANIFEST);
  const specs = new Map<string, string>();

  if (!existsSync(file)) return specs;

  const parsed = parseUntrustedJson(readFileSync(file, "utf8"));

  if (!parsed.ok)
    throw new Error(
      `bundle: the app's ${file} ${parsed.problem}; fix it so its dependencies can be read.`,
    );

  for (const field of DEPENDENCY_FIELDS) {
    const dependencies: unknown = finalizeIsRecord(parsed.value) ? parsed.value[field] : undefined;

    if (!finalizeIsRecord(dependencies)) continue;

    for (const [name, spec] of Object.entries(dependencies))
      if (typeof spec === "string" && !specs.has(name)) specs.set(name, spec);
  }

  return specs;
}
