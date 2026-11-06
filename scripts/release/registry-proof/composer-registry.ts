// Points an assembled PHP consumer at the released Composer packages: each `seampact/*` requirement of the app and
// of its copy of the suite doubles package at the release version, resolved from the rehearsal's bare mirrors (one
// `vcs` repository per mirror, Packagist for everything else) or from Packagist alone. The suite doubles package is
// never published, so it stays a path repository, the copy given.
//   node scripts/release/registry-proof/composer-registry.ts <app-dir> --suite <suite-copy-dir> --version <version>
//     [--mirrors <bare-mirrors-dir>] [--root <dir>]
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isJsonRecord } from "../json-record.ts";
import { phpPackageNames } from "../php/mirror-commits.ts";
import { parsedArguments, ROOT_OPTION, repositoryRoot, runReleaseCommand } from "../release-cli.ts";
import { ReleaseError, releaseVersion } from "../release-version.ts";

const USAGE =
  "node scripts/release/registry-proof/composer-registry.ts <app-dir> --suite <suite-copy-dir> --version <version> " +
  "[--mirrors <bare-mirrors-dir>] [--root <dir>]";
const COMPOSER_FILE = "composer.json";
const SEAMPACT_VENDOR = "seampact/";
const SEAMPACT_PACKAGES = "seampact/*";
const SUITE_PACKAGE = "seampact/consumer-suite";
// The suite doubles package's version for the app's requirement, as the consumer's own path repository gives it.
const SUITE_VERSION = "dev-develop";
const PACKAGIST_URL = "https://repo.packagist.org";

export type ComposerRepository = Record<string, unknown>;

/** Where the released packages come from: the rehearsal's bare mirrors, or Packagist. */
export type ReleasedPackageSource =
  | { readonly kind: "mirrors"; readonly mirrorUrls: readonly string[] }
  | { readonly kind: "packagist" };

/** The repositories of the app: the suite copy by path, then the released packages' source. */
export function consumerRepositories(
  suiteDirectory: string,
  source: ReleasedPackageSource,
): ComposerRepository[] {
  const suite: ComposerRepository = {
    type: "path",
    url: suiteDirectory,
    options: { symlink: false, versions: { [SUITE_PACKAGE]: SUITE_VERSION } },
  };

  if (source.kind === "packagist") return [suite];

  // Packagist stays for the third-party packages; a seampact package missing from the mirrors fails the install.
  return [
    suite,
    ...source.mirrorUrls.map((url) => ({ type: "vcs", url })),
    { type: "composer", url: PACKAGIST_URL, exclude: [SEAMPACT_PACKAGES] },
    { "packagist.org": false },
  ];
}

/** [manifest] with every released `seampact/*` requirement at [version], the suite package left as it is. */
export function withReleasedRequirements(
  manifest: Record<string, unknown>,
  version: string,
): Record<string, unknown> {
  const requirements = manifest.require;

  if (!isJsonRecord(requirements)) {
    throw new ReleaseError(
      `the manifest has no \`require\` object: ${JSON.stringify(manifest.name)}`,
    );
  }

  const released = Object.entries(requirements).map(([name, constraint]) =>
    name.startsWith(SEAMPACT_VENDOR) && name !== SUITE_PACKAGE
      ? [name, version]
      : [name, constraint],
  );

  return { ...manifest, require: Object.fromEntries(released) };
}

function readManifest(file: string): Record<string, unknown> {
  const manifest: unknown = JSON.parse(readFileSync(file, "utf8"));

  if (!isJsonRecord(manifest)) throw new ReleaseError(`${file} is not a JSON object`);

  return manifest;
}

function writeManifest(file: string, manifest: Record<string, unknown>): void {
  writeFileSync(file, `${JSON.stringify(manifest, null, 4)}\n`);
}

function releasedPackageSource(root: string, mirrors: string | undefined): ReleasedPackageSource {
  if (mirrors === undefined) return { kind: "packagist" };

  const mirrorsDirectory = resolve(mirrors);

  return {
    kind: "mirrors",
    mirrorUrls: phpPackageNames(root).map((name) => join(mirrorsDirectory, `seampact-${name}.git`)),
  };
}

function main(): void {
  const { values, positionals } = parsedArguments(
    {
      ...ROOT_OPTION,
      suite: { type: "string" },
      version: { type: "string" },
      mirrors: { type: "string" },
    },
    USAGE,
  );
  const [appDirectory, ...extra] = positionals;

  if (appDirectory === undefined || extra.length > 0 || values.suite === undefined) {
    throw new ReleaseError(`pass one <app-dir> and --suite; usage: ${USAGE}`);
  }

  const version = releaseVersion(values.version);
  const suiteDirectory = resolve(values.suite);
  const source = releasedPackageSource(repositoryRoot(values.root), values.mirrors);
  const appFile = join(resolve(appDirectory), COMPOSER_FILE);
  const suiteFile = join(suiteDirectory, COMPOSER_FILE);

  writeManifest(suiteFile, withReleasedRequirements(readManifest(suiteFile), version));
  writeManifest(appFile, {
    ...withReleasedRequirements(readManifest(appFile), version),
    repositories: consumerRepositories(suiteDirectory, source),
  });
  console.log(
    `composer-registry: ${appFile} takes seampact/* ${version} from ${source.kind === "mirrors" ? values.mirrors : "Packagist"}`,
  );
}

if (import.meta.main) await runReleaseCommand("composer-registry", main);
