// The manifest of the Python distributions a release publishes: the file, name, version, kind and SHA-256 of each,
// written by build-python and passed to the publish job as a job output, outside the artefact. Every workspace
// distribution ships one pure wheel and one sdist; seampact-compiler ships one platform wheel per release binary and
// no sdist, each holding its binary as SHA256SUMS lists it. A job that publishes takes exactly the files the manifest
// lists, each checked against its hash, and refuses any other file of the artefact.
//   node scripts/release/python/dist-manifest.ts write <dist-dir> --version <version> --sums <SHA256SUMS>
//     --manifest <file> [--root <dir>]
//   node scripts/release/python/dist-manifest.ts verify <dist-dir> --manifest <file> --version <version> [--root <dir>]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isJsonRecord } from "../json-record.ts";
import { normalizedName, pythonProjects } from "../python-versions.ts";
import { parsedArguments, ROOT_OPTION, repositoryRoot, runReleaseCommand } from "../release-cli.ts";
import { ReleaseError, releaseVersion } from "../release-version.ts";

export const COMPILER_DISTRIBUTION = "seampact-compiler";
// One wheel per release binary: linux x64 and arm64, macOS x64 and arm64, Windows x64.
export const COMPILER_WHEEL_COUNT = 5;
const COMPILER_BINARY_DIRECTORY = "seampact/compiler/bin/";
// A binary is read whole to hash it; the five are well under this size.
const WHEEL_MEMBER_MAX_BYTES = 512 * 1024 * 1024;

const WHEEL_FILE = /^([A-Za-z0-9][A-Za-z0-9._]*)-([^-]+)(?:-\d[^-]*)?-[^-]+-[^-]+-[^-]+\.whl$/;
const SDIST_FILE = /^([A-Za-z0-9][A-Za-z0-9._-]*)-([^-]+)\.tar\.gz$/;

export type DistributionKind = "wheel" | "sdist";

export interface DistributionManifestEntry {
  /** The file name in the distribution directory. */
  readonly file: string;
  /** The PEP 503 normalized distribution name. */
  readonly name: string;
  readonly version: string;
  readonly kind: DistributionKind;
  readonly sha256: string;
}

/** What a release publishes: its distributions, each at the version. */
export interface ExpectedDistributions {
  readonly version: string;
  readonly names: readonly string[];
}

/** The name, version and kind a distribution file name carries; any other file is refused by name. */
export function distributionIdentity(
  file: string,
): Omit<DistributionManifestEntry, "file" | "sha256"> {
  const wheel = WHEEL_FILE.exec(file);

  if (wheel?.[1] !== undefined && wheel[2] !== undefined)
    return { name: normalizedName(wheel[1]), version: wheel[2], kind: "wheel" };

  const sdist = SDIST_FILE.exec(file);

  if (sdist?.[1] !== undefined && sdist[2] !== undefined)
    return { name: normalizedName(sdist[1]), version: sdist[2], kind: "sdist" };

  throw new ReleaseError(
    `${file} is neither a wheel (<name>-<version>-<tags>.whl) nor an sdist (<name>-<version>.tar.gz)`,
  );
}

/** The distributions of the release: every `python/*` project. */
export function releaseDistributionNames(root: string): string[] {
  return pythonProjects(root).map((project) => normalizedName(project.name));
}

export function distributionManifest(directory: string): DistributionManifestEntry[] {
  return readdirSync(directory)
    .sort()
    .map((file) => ({
      file,
      ...distributionIdentity(file),
      sha256: fileSha256(join(directory, file)),
    }));
}

export function parsedDistributionManifest(
  text: string,
  source: string,
): DistributionManifestEntry[] {
  const refused = (problem: string) =>
    new ReleaseError(`${source} is not the distribution manifest build-python writes: ${problem}`);
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw refused(error instanceof Error ? error.message : String(error));
  }

  if (!Array.isArray(parsed) || parsed.length === 0) throw refused("not a non-empty array");

  return parsed.map((entry: unknown, index) => {
    const { file, name, version, kind, sha256 } = isJsonRecord(entry) ? entry : {};

    if (
      typeof file !== "string" ||
      typeof name !== "string" ||
      typeof version !== "string" ||
      (kind !== "wheel" && kind !== "sdist") ||
      typeof sha256 !== "string"
    )
      throw refused(
        `entry ${index} has no string file, name, version, sha256 and a wheel or sdist kind`,
      );

    return { file, name, version, kind, sha256 };
  });
}

/**
 * The manifest's entries, once the directory holds exactly its files with their hashes and the manifest is exactly
 * the expected release. Throws a `ReleaseError` naming every problem.
 */
export function manifestDistributions(
  directory: string,
  manifest: readonly DistributionManifestEntry[],
  expected: ExpectedDistributions,
): DistributionManifestEntry[] {
  failOnProblems([
    ...releaseProblems(manifest, expected),
    ...directoryProblems(directory, manifest),
  ]);

  return [...manifest];
}

/** Each seampact-compiler wheel holds one binary, hashed as SHA256SUMS lists it, and each binary is in one wheel. */
export function compilerWheelProblems(
  directory: string,
  manifest: readonly DistributionManifestEntry[],
  sha256Sums: string,
): string[] {
  const listedHashes = sha256SumsEntries(sha256Sums);
  const wheeledAssets: string[] = [];
  const problems: string[] = [];

  for (const entry of manifest.filter((candidate) => candidate.name === COMPILER_DISTRIBUTION)) {
    const wheel = join(directory, entry.file);
    const binaries = wheelMembers(wheel).filter(
      (member) => member.startsWith(COMPILER_BINARY_DIRECTORY) && !member.endsWith("/"),
    );

    if (binaries.length !== 1 || binaries[0] === undefined) {
      problems.push(
        `${entry.file} holds ${binaries.length} binaries under ${COMPILER_BINARY_DIRECTORY}, not one`,
      );
      continue;
    }

    const asset = binaries[0].slice(COMPILER_BINARY_DIRECTORY.length);
    const listed = listedHashes.get(asset);
    const actual = createHash("sha256").update(wheelMember(wheel, binaries[0])).digest("hex");

    wheeledAssets.push(asset);

    if (listed === undefined)
      problems.push(`${entry.file} holds ${asset}, which SHA256SUMS does not list`);
    else if (listed !== actual)
      problems.push(
        `${entry.file} holds ${asset} hashing ${actual}, not the ${listed} SHA256SUMS lists`,
      );
  }

  for (const asset of listedHashes.keys()) {
    const count = wheeledAssets.filter((wheeled) => wheeled === asset).length;

    if (count !== 1)
      problems.push(`${asset} is in ${count} ${COMPILER_DISTRIBUTION} wheels, not one`);
  }

  return problems;
}

export function failOnProblems(problems: readonly string[]): void {
  if (problems.length > 0)
    throw new ReleaseError(
      `the distributions are not the ones build-python checked, so nothing was published:\n  ${problems.join("\n  ")}`,
    );
}

export function fileSha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function releaseProblems(
  manifest: readonly DistributionManifestEntry[],
  expected: ExpectedDistributions,
): string[] {
  const problems = manifest
    .filter((entry) => entry.version !== expected.version)
    .map((entry) => `${entry.file} is ${entry.name} ${entry.version}, not at ${expected.version}`);

  for (const entry of manifest)
    if (!expected.names.includes(entry.name))
      problems.push(`${entry.file} is ${entry.name}, not a distribution the release publishes`);

  for (const name of expected.names) {
    const files = manifest.filter((entry) => entry.name === name);
    const wheels = files.filter((entry) => entry.kind === "wheel").length;
    const sdists = files.length - wheels;
    const [expectedWheels, expectedSdists] =
      name === COMPILER_DISTRIBUTION ? [COMPILER_WHEEL_COUNT, 0] : [1, 1];

    if (wheels !== expectedWheels || sdists !== expectedSdists)
      problems.push(
        `${name} has ${wheels} wheels and ${sdists} sdists, not the ${expectedWheels} and ${expectedSdists} the release publishes`,
      );
  }

  return problems;
}

function directoryProblems(
  directory: string,
  manifest: readonly DistributionManifestEntry[],
): string[] {
  const present = readdirSync(directory);
  const problems = present
    .filter((file) => !manifest.some((entry) => entry.file === file))
    .map((file) => `${file} is in the artefact, but not in the manifest`);

  for (const entry of manifest) {
    if (!present.includes(entry.file)) {
      problems.push(`${entry.file} is in the manifest, but not in the artefact`);
      continue;
    }

    const sha256 = fileSha256(join(directory, entry.file));

    if (sha256 !== entry.sha256)
      problems.push(`${entry.file} hashes ${sha256}, not the ${entry.sha256} build-python wrote`);

    const identity = distributionIdentity(entry.file);

    if (
      identity.name !== entry.name ||
      identity.version !== entry.version ||
      identity.kind !== entry.kind
    )
      problems.push(
        `${entry.file} is a ${identity.kind} of ${identity.name} ${identity.version}, not as listed`,
      );
  }

  return problems;
}

// `<sha256>  <asset>` lines, as the binary call writes them.
function sha256SumsEntries(text: string): Map<string, string> {
  const entries = new Map<string, string>();

  for (const line of text.split("\n").filter((candidate) => candidate.trim() !== "")) {
    const match = /^([0-9a-f]{64}) [ *](\S+)$/.exec(line);

    if (match?.[1] === undefined || match[2] === undefined)
      throw new ReleaseError(`SHA256SUMS has the line "${line}", not "<sha256>  <asset>"`);

    entries.set(match[2], match[1]);
  }

  return entries;
}

function wheelMembers(wheel: string): string[] {
  return execFileSync("unzip", ["-Z1", wheel], { encoding: "utf8" }).split("\n").filter(Boolean);
}

function wheelMember(wheel: string, member: string): Buffer {
  return execFileSync("unzip", ["-p", wheel, member], { maxBuffer: WHEEL_MEMBER_MAX_BYTES });
}

const USAGE =
  "node scripts/release/python/dist-manifest.ts write|verify <dist-dir> --version <version> --manifest <file> " +
  "[--sums <SHA256SUMS>] [--root <dir>]";

if (import.meta.main)
  await runReleaseCommand("dist-manifest", () => {
    const { values, positionals } = parsedArguments(
      {
        ...ROOT_OPTION,
        version: { type: "string" },
        manifest: { type: "string" },
        sums: { type: "string" },
      },
      USAGE,
    );
    const [command, directoryArgument] = positionals;

    if (directoryArgument === undefined || values.manifest === undefined)
      throw new ReleaseError(
        `the distribution directory and --manifest are required; usage: ${USAGE}`,
      );

    const directory = resolve(directoryArgument);
    const expected = {
      version: releaseVersion(values.version),
      names: releaseDistributionNames(repositoryRoot(values.root)),
    };

    if (command === "write") {
      if (values.sums === undefined) throw new ReleaseError(`write needs --sums; usage: ${USAGE}`);

      const manifest = distributionManifest(directory);

      manifestDistributions(directory, manifest, expected);
      failOnProblems(compilerWheelProblems(directory, manifest, readFileSync(values.sums, "utf8")));
      writeFileSync(values.manifest, JSON.stringify(manifest));
      console.log(
        `dist-manifest: ${manifest.length} distributions checked and listed in ${values.manifest}`,
      );

      return;
    }

    if (command !== "verify")
      throw new ReleaseError(`unknown command "${command ?? ""}"; usage: ${USAGE}`);

    const manifest = parsedDistributionManifest(
      readFileSync(values.manifest, "utf8"),
      values.manifest,
    );

    manifestDistributions(directory, manifest, expected);
    console.log(
      `dist-manifest: the ${manifest.length} distributions of ${directory} are the listed ones`,
    );
  });
