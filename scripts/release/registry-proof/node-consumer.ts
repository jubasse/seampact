// The NestJS consumer of the registry proof: the test consumer of `scripts/consumers` (template and `nestjs` overlay,
// zod validators) with every published `@seampact/*` package at the release version from one npm registry, the
// rehearsal's local one or npmjs, in place of the checkout's tarballs. It installs, generates, checks, typechecks and
// runs the http suite's `default`, `hand-written` and `boot` profiles as a user's app would.
//   node scripts/release/registry-proof/node-consumer.ts --registry <url> --version <version> --dir <new-dir>
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stringify } from "yaml";
import { assembleConsumer } from "../../consumers/consumer-project.ts";
import { runStep, StepFailure } from "../../consumers/run-step.ts";
import { DEFAULT_VALIDATOR_CHOICE, validatorChoice } from "../../consumers/validator-choice.ts";
import { REPO_ROOT as REPOSITORY_ROOT } from "../../golden/repo-root.ts";
import { isJsonRecord } from "../json-record.ts";
import { publishedPackageNames } from "../npm-versions.ts";
import { parsedArguments, runReleaseCommand } from "../release-cli.ts";
import { ReleaseError, releaseVersion } from "../release-version.ts";

const USAGE =
  "node scripts/release/registry-proof/node-consumer.ts --registry <url> --version <version> --dir <new-dir>";
const CONSUMERS_ROOT = join(REPOSITORY_ROOT, "scripts/consumers");
const TARGET = "nestjs";
const PACKAGE_FILE = "package.json";
const NPM_SETTINGS_FILE = ".npmrc";
const PNPM_SETTINGS_FILE = "pnpm-workspace.yaml";
const SEAMPACT_SCOPE = "@seampact/*";

// esbuild, under the tsx that starts the suite's boot processes, checks its platform binary in a build script, which
// pnpm runs only when told. A release is installed the day it is published, younger than pnpm's minimum release age.
const PNPM_SETTINGS = {
  allowBuilds: { esbuild: true },
  minimumReleaseAgeExclude: [SEAMPACT_SCOPE],
};

const INSTALL_ARGS: readonly string[] = ["install", "--no-frozen-lockfile"];
const LIST_ARGS: readonly string[] = ["list", "--json", "--depth", "Infinity"];
const SEAMPACT_PREFIX = "@seampact/";
// The full dependency tree of the consumer, well under this.
const LISTING_MAX_BYTES = 64 * 1024 * 1024;
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

const CONSUMER_STEPS: readonly (readonly [string, readonly string[]])[] = [
  ["generate", ["exec", "seampact", "generate"]],
  ["check", ["exec", "seampact", "check"]],
  ["typecheck", ["exec", "tsc", "--noEmit"]],
  ["test", ["exec", "vitest", "run"]],
];

/** The consumer's manifest with each published package added at exactly [version]. */
export function withPublishedPackages(
  manifest: Record<string, unknown>,
  packageNames: readonly string[],
  version: string,
): Record<string, unknown> {
  const dependencies = isJsonRecord(manifest.dependencies) ? manifest.dependencies : {};
  const published = Object.fromEntries(packageNames.map((name) => [name, version]));

  return { ...manifest, dependencies: { ...dependencies, ...published } };
}

/**
 * Each `@seampact/*` package of a `pnpm list --json --depth Infinity` listing, at any depth, whose version is not
 * [version], as `name@version`, so a looser internal range never installs another release unseen.
 */
export function seampactPackagesOffVersion(listing: unknown, version: string): string[] {
  const offVersion = new Set<string>();
  const visit = (node: unknown): void => {
    if (!isJsonRecord(node)) return;

    for (const field of DEPENDENCY_FIELDS) {
      const dependencies = node[field];

      if (!isJsonRecord(dependencies)) continue;

      for (const [name, dependency] of Object.entries(dependencies)) {
        const installed = isJsonRecord(dependency) ? dependency.version : undefined;

        if (name.startsWith(SEAMPACT_PREFIX) && installed !== version) {
          offVersion.add(`${name}@${String(installed)}`);
        }

        visit(dependency);
      }
    }
  };

  for (const project of Array.isArray(listing) ? listing : [listing]) visit(project);

  return [...offVersion].sort();
}

/** The `.npmrc` that sends every install of the consumer to [registry]. */
export function registrySettings(registry: string): string {
  const url = new URL(registry);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ReleaseError(`--registry '${registry}' is not an http or https URL`);
  }

  return `registry=${url.href}\n`;
}

function newDirectory(written: string): string {
  const directory = resolve(written);

  if (existsSync(directory) && readdirSync(directory).length > 0) {
    throw new ReleaseError(`--dir ${directory} is not empty: give a new directory`);
  }

  return directory;
}

function assembleFromRegistry(directory: string, registry: string, version: string): void {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY_ROOT })
    .toString()
    .trim();

  assembleConsumer({
    consumersRoot: CONSUMERS_ROOT,
    repositoryRoot: REPOSITORY_ROOT,
    target: TARGET,
    validators: validatorChoice(DEFAULT_VALIDATOR_CHOICE),
    directory,
    commit,
  });

  const manifestFile = join(directory, PACKAGE_FILE);
  const manifest: unknown = JSON.parse(readFileSync(manifestFile, "utf8"));

  if (!isJsonRecord(manifest)) throw new ReleaseError(`${manifestFile} is not a JSON object`);

  const published = withPublishedPackages(
    manifest,
    publishedPackageNames(REPOSITORY_ROOT),
    version,
  );

  writeFileSync(manifestFile, `${JSON.stringify(published, null, 2)}\n`);
  writeFileSync(join(directory, NPM_SETTINGS_FILE), registrySettings(registry));
  writeFileSync(join(directory, PNPM_SETTINGS_FILE), stringify(PNPM_SETTINGS));
}

function checkInstalledVersions(directory: string, version: string): void {
  const listing: unknown = JSON.parse(
    execFileSync("pnpm", LIST_ARGS, { cwd: directory, maxBuffer: LISTING_MAX_BYTES }).toString(),
  );
  const offVersion = seampactPackagesOffVersion(listing, version);

  if (offVersion.length > 0) {
    throw new ReleaseError(
      `these installed packages are not at ${version}: ${offVersion.join(", ")}`,
    );
  }

  console.log(`node-consumer: every installed @seampact/* package is at ${version}`);
}

function main(): void {
  const { values, positionals } = parsedArguments(
    {
      registry: { type: "string" },
      version: { type: "string" },
      dir: { type: "string" },
    },
    USAGE,
  );

  if (positionals.length > 0 || values.registry === undefined || values.dir === undefined) {
    throw new ReleaseError(`pass --registry, --version and --dir; usage: ${USAGE}`);
  }

  const version = releaseVersion(values.version);
  const directory = newDirectory(values.dir);

  assembleFromRegistry(directory, values.registry, version);
  console.log(
    `node-consumer: the ${TARGET} consumer in ${directory} takes @seampact/* ${version} from ${values.registry}`,
  );

  try {
    runStep({ title: "install", command: "pnpm", args: INSTALL_ARGS, cwd: directory });
    checkInstalledVersions(directory, version);

    for (const [title, args] of CONSUMER_STEPS) {
      runStep({ title, command: "pnpm", args, cwd: directory });
    }
  } catch (error) {
    if (error instanceof StepFailure) throw new ReleaseError(error.message);

    throw error;
  }

  console.log(
    `node-consumer: the ${TARGET} consumer passed the http suite on @seampact/* ${version}`,
  );
}

if (import.meta.main) await runReleaseCommand("node-consumer", main);
