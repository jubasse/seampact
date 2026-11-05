// The local check of a JVM staging bundle against what Maven Central validates, run before the manifest is written:
// exactly the expected coordinates at the version and nothing else, a POM with the fields Central requires on each,
// sources and javadoc jars beside each jar, a signature, an MD5 and a SHA-1 beside each file with the right digests,
// and the compiler's five binaries each with the hash `SHA256SUMS` lists for its asset.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Of } from "./bundle-manifest.ts";
import {
  COMPILER_MODULE,
  type Coordinate,
  DOCS_URL,
  type ExpectedBundle,
  versionDirectory,
} from "./jvm-release.ts";

const SIGNATURE_SUFFIX = ".asc";
// The digests Central requires beside each file, and the ones it accepts besides.
const REQUIRED_CHECKSUMS = ["md5", "sha1"] as const;
const CHECKSUMS = ["md5", "sha1", "sha256", "sha512"] as const;
const DERIVED_SUFFIXES = [SIGNATURE_SUFFIX, ...CHECKSUMS.map((algorithm) => `.${algorithm}`)];
const COMPILER_EXTENSION = ".exe";
const SUMS_LINE = /^([0-9a-f]{64}) {2}(\S+)$/;

/** The SHA-256 per release asset of a `SHA256SUMS` text. */
export function parsedReleaseSums(text: string): Map<string, string> {
  const sums = new Map<string, string>();

  for (const line of text.split("\n").filter((candidate) => candidate !== "")) {
    const match = SUMS_LINE.exec(line);

    if (match?.[1] !== undefined && match[2] !== undefined) sums.set(match[2], match[1]);
  }

  return sums;
}

/** Every way the bundle differs from what Central accepts for the expected release; empty when it matches. */
export function bundleLayoutProblems(
  directory: string,
  files: readonly string[],
  expected: ExpectedBundle,
  releaseSums: ReadonlyMap<string, string>,
): string[] {
  const problems: string[] = [];
  const filesByCoordinate = new Map(
    expected.coordinates.map((coordinate) => [coordinate, [] as string[]]),
  );

  for (const path of files) {
    const coordinate = expected.coordinates.find((candidate) =>
      path.startsWith(`${versionDirectory(candidate, expected.version)}/`),
    );
    const fileName = path.slice(path.lastIndexOf("/") + 1);

    if (
      coordinate === undefined ||
      path.slice(0, path.lastIndexOf("/")) !== versionDirectory(coordinate, expected.version)
    )
      problems.push(`${path} is no file of an expected artefact at ${expected.version}`);
    else filesByCoordinate.get(coordinate)?.push(fileName);
  }

  for (const [coordinate, fileNames] of filesByCoordinate) {
    const versionPath = versionDirectory(coordinate, expected.version);
    const artefact = {
      directory: join(directory, versionPath),
      versionPath,
      coordinate,
      fileNames,
    };

    problems.push(...artefactProblems(artefact, expected));
  }

  if (expected.compilerClassifiers.size > 0)
    problems.push(...compilerProblems(directory, files, expected, releaseSums));

  return problems;
}

interface StagedArtefact {
  readonly directory: string;
  readonly versionPath: string;
  readonly coordinate: Coordinate;
  readonly fileNames: readonly string[];
}

function artefactProblems(artefact: StagedArtefact, expected: ExpectedBundle): string[] {
  const { coordinate, fileNames, versionPath } = artefact;
  const baseName = `${coordinate.artifactId}-${expected.version}`;

  if (fileNames.length === 0)
    return [
      `${coordinate.group}:${coordinate.artifactId}:${expected.version} has no file in the bundle`,
    ];

  const primaries = fileNames.filter(
    (name) => !DERIVED_SUFFIXES.some((suffix) => name.endsWith(suffix)),
  );
  const problems = fileNames
    .filter((name) => !name.startsWith(`${baseName}.`) && !name.startsWith(`${baseName}-`))
    .map((name) => `${versionPath}/${name} is not named after ${baseName}`);

  for (const name of fileNames.filter((candidate) => !primaries.includes(candidate)))
    if (
      !primaries.some((primary) =>
        DERIVED_SUFFIXES.some((suffix) => `${primary}${suffix}` === name),
      )
    )
      problems.push(`${versionPath}/${name} signs or digests no file of the bundle`);

  for (const primary of primaries) problems.push(...derivedFileProblems(artefact, primary));

  const pom = `${baseName}.pom`;

  if (!primaries.includes(pom)) problems.push(`${versionPath} has no ${pom}`);
  else
    problems.push(
      ...pomProblems(
        join(artefact.directory, pom),
        `${versionPath}/${pom}`,
        coordinate,
        expected.version,
      ),
    );

  if (primaries.includes(`${baseName}.jar`))
    for (const documentation of [`${baseName}-sources.jar`, `${baseName}-javadoc.jar`])
      if (!primaries.includes(documentation))
        problems.push(
          `${versionPath} has a jar but no ${documentation}, which Central requires beside it`,
        );

  return problems;
}

function derivedFileProblems(artefact: StagedArtefact, primary: string): string[] {
  const problems: string[] = [];
  const path = `${artefact.versionPath}/${primary}`;

  if (!artefact.fileNames.includes(`${primary}${SIGNATURE_SUFFIX}`))
    problems.push(`${path} has no signature ${primary}${SIGNATURE_SUFFIX}`);

  const bytes = readFileSync(join(artefact.directory, primary));

  for (const algorithm of CHECKSUMS) {
    const checksumFile = `${primary}.${algorithm}`;

    if (!artefact.fileNames.includes(checksumFile)) {
      if ((REQUIRED_CHECKSUMS as readonly string[]).includes(algorithm))
        problems.push(`${path} has no ${checksumFile}`);
      continue;
    }

    const listed = readFileSync(join(artefact.directory, checksumFile), "utf8").trim();
    const actual = createHash(algorithm).update(bytes).digest("hex");

    if (listed !== actual)
      problems.push(`${path}.${algorithm} says ${listed}, but the file digests to ${actual}`);
  }

  return problems;
}

// The POM fields Central requires. Gradle writes them before `<dependencies>`, so only the text before is read.
function pomProblems(
  file: string,
  path: string,
  coordinate: Coordinate,
  version: string,
): string[] {
  const head = readFileSync(file, "utf8").split(/<dependencies>|<dependencyManagement>/)[0] ?? "";
  const projectFields = withoutBlocks(head, [
    "parent",
    "licenses",
    "developers",
    "scm",
    "organization",
  ]);
  const license = block(block(head, "licenses"), "license");
  const developer = block(block(head, "developers"), "developer");
  const scm = block(head, "scm");
  const problems: string[] = [];

  const identity: [string, string][] = [
    ["groupId", coordinate.group],
    ["artifactId", coordinate.artifactId],
    ["version", version],
    ["url", DOCS_URL],
  ];

  for (const [name, value] of identity) {
    const actual = block(projectFields, name);

    if (actual !== value) problems.push(`${path} has <${name}> "${actual}", not "${value}"`);
  }

  const required: [string, string][] = [
    ["name", block(projectFields, "name")],
    ["description", block(projectFields, "description")],
    ["license name", block(license, "name")],
    ["license url", block(license, "url")],
    ["developer id", block(developer, "id")],
    ["scm connection", block(scm, "connection")],
    ["scm url", block(scm, "url")],
  ];

  for (const [name, value] of required)
    if (value === "") problems.push(`${path} has no ${name}, which Central requires`);

  return problems;
}

/** The trimmed text inside the first `<tag>` of the text, empty when it has none. */
function block(text: string, tag: string): string {
  return new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1]?.trim() ?? "";
}

function withoutBlocks(text: string, tags: readonly string[]): string {
  return tags.reduce(
    (remaining, tag) => remaining.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`), ""),
    text,
  );
}

function compilerProblems(
  directory: string,
  files: readonly string[],
  expected: ExpectedBundle,
  releaseSums: ReadonlyMap<string, string>,
): string[] {
  const coordinate = expected.coordinates.find(
    (candidate) => candidate.artifactId === COMPILER_MODULE,
  );

  if (coordinate === undefined)
    return ["the bundle expects compiler binaries but no compiler artefact"];

  const versionPath = versionDirectory(coordinate, expected.version);
  const baseName = `${coordinate.artifactId}-${expected.version}`;
  const problems: string[] = [];
  const binaries = files.filter(
    (path) => path.startsWith(`${versionPath}/`) && path.endsWith(COMPILER_EXTENSION),
  );
  const expectedBinaries = [...expected.compilerClassifiers.values()].map(
    (classifier) => `${versionPath}/${baseName}-${classifier}${COMPILER_EXTENSION}`,
  );

  for (const binary of binaries)
    if (!expectedBinaries.includes(binary))
      problems.push(`${binary} is no compiler classifier of the release`);

  for (const [asset, classifier] of expected.compilerClassifiers) {
    const binary = `${versionPath}/${baseName}-${classifier}${COMPILER_EXTENSION}`;
    const listed = releaseSums.get(asset);

    if (!files.includes(binary)) {
      problems.push(
        `${binary} is missing: the release publishes ${asset} as the ${classifier} classifier`,
      );
      continue;
    }

    const actual = sha256Of(readFileSync(join(directory, binary)));

    if (listed === undefined)
      problems.push(`SHA256SUMS lists no ${asset}, so ${binary} cannot be checked`);
    else if (actual !== listed)
      problems.push(`${binary} hashes ${actual}, but SHA256SUMS lists ${listed} for ${asset}`);
  }

  return problems;
}
