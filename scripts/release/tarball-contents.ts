// The content check of an npm tarball before it is published: only the package's own tracked files and its build
// output, no test or fixture, the LICENSE and README present, a manifest at the release version that npm can
// publish with provenance, its seampact dependencies at that version, and a pack's manifest at it too.
import { BUILD_DIRECTORY } from "../consumers/packed-packages.ts";
import { isJsonRecord } from "./json-record.ts";
import { PACK_VERSION_LINE, packEntry } from "./pack-versions.ts";

export const REPOSITORY_URL = "git+https://github.com/jubasse/seampact.git";

// `pnpm pack` writes the manifest and copies the workspace LICENSE when the package has none.
const PACKED_BY_PNPM = new Set(["package.json", "LICENSE"]);
const REQUIRED_FILES = ["LICENSE", "README.md"];
const TEST_DIRECTORY_NAMES = new Set([
  "test",
  "tests",
  "__tests__",
  "fixtures",
  "__fixtures__",
  "__snapshots__",
]);
const TEST_FILE_NAME = /\.(?:test|spec|type-check)\.|test-support\.|\.tsbuildinfo$/;
const RUNTIME_DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];
const DEPENDENCY_FIELDS = [...RUNTIME_DEPENDENCY_FIELDS, "devDependencies"];
const SEAMPACT_SCOPE = "@seampact/";
const LOCAL_SPECIFIER = /^(?:workspace|link|file|portal):/;

export interface PackedPackage {
  /** Repository-relative package directory, `packages/core/cli`. */
  readonly directory: string;
  /** The files of the tarball, relative to its `package/` directory. */
  readonly files: readonly string[];
  /** The packed `package.json`, parsed. */
  readonly manifest: unknown;
  /** The package's files git tracks, relative to the package directory. */
  readonly trackedFiles: ReadonlySet<string>;
  /** The text of the pack manifest the packed `seampact.pack` names, `undefined` when the tarball has none. */
  readonly packManifestText?: string | undefined;
}

export interface ExpectedPackage {
  readonly name: string;
  readonly version: string;
}

/** One line per problem, each naming the file or field; empty when the tarball can be published. */
export function tarballProblems(packed: PackedPackage, expected: ExpectedPackage): string[] {
  return [
    ...fileProblems(packed),
    ...manifestProblems(packed, expected),
    ...packManifestProblems(packed, expected),
  ];
}

function fileProblems(packed: PackedPackage): string[] {
  const problems = REQUIRED_FILES.filter((file) => !packed.files.includes(file)).map(
    (file) => `${file} is missing: add it to the package (pnpm copies the workspace LICENSE only)`,
  );

  for (const file of packed.files) {
    const segments = file.split("/");

    if (segments.some((segment) => TEST_DIRECTORY_NAMES.has(segment)) || TEST_FILE_NAME.test(file))
      problems.push(`${file} is a test, fixture or build-cache file: leave it out of \`files\``);
    else if (
      !(
        packed.trackedFiles.has(file) ||
        PACKED_BY_PNPM.has(file) ||
        segments[0] === BUILD_DIRECTORY
      )
    )
      problems.push(
        `${file} is neither a tracked file nor build output (git-ignored or stray): leave it out of \`files\``,
      );
  }

  return problems;
}

function manifestProblems(packed: PackedPackage, expected: ExpectedPackage): string[] {
  const manifest = isJsonRecord(packed.manifest) ? packed.manifest : {};
  const problems: string[] = [];

  if (manifest.name !== expected.name)
    problems.push(`package.json names ${JSON.stringify(manifest.name)}, not ${expected.name}`);

  if (manifest.version !== expected.version)
    problems.push(
      `package.json is at ${JSON.stringify(manifest.version)}, not ${expected.version}: run the stamp`,
    );

  if ("private" in manifest) problems.push("package.json is still `private`: run the stamp");

  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = manifest[field];

    if (!isJsonRecord(dependencies)) continue;

    for (const [name, specifier] of Object.entries(dependencies))
      if (typeof specifier === "string" && LOCAL_SPECIFIER.test(specifier))
        problems.push(
          `package.json ${field} keeps the local specifier ${name}@${specifier}: pack it with pnpm`,
        );
  }

  problems.push(...seampactDependencyProblems(manifest, expected.version));
  problems.push(...repositoryProblems(manifest.repository, packed.directory));

  return problems;
}

// A range would let an install mix two releases; a local specifier is reported on its own above.
function seampactDependencyProblems(manifest: Record<string, unknown>, version: string): string[] {
  const problems: string[] = [];

  for (const field of RUNTIME_DEPENDENCY_FIELDS) {
    const dependencies = manifest[field];

    if (!isJsonRecord(dependencies)) continue;

    for (const [name, specifier] of Object.entries(dependencies)) {
      if (!name.startsWith(SEAMPACT_SCOPE) || specifier === version) continue;

      if (typeof specifier === "string" && LOCAL_SPECIFIER.test(specifier)) continue;

      problems.push(
        `package.json ${field} gives ${name} ${JSON.stringify(specifier)}, not exactly ${version}: depend on it with workspace:*`,
      );
    }
  }

  return problems;
}

// The loader refuses a pack whose manifest version differs from its package.json (grammar section 02).
function packManifestProblems(packed: PackedPackage, expected: ExpectedPackage): string[] {
  const entry = packEntry(packed.manifest);

  if (entry === undefined) return [];

  if (packed.packManifestText === undefined)
    return [`${entry} is missing: the package.json names it as its \`seampact.pack\``];

  const written = PACK_VERSION_LINE.exec(packed.packManifestText)?.[2];

  if (written !== expected.version)
    return [
      `${entry} gives pack.version ${JSON.stringify(written ?? null)}, not ${expected.version}: run the stamp`,
    ];

  return [];
}

// npm refuses a provenance statement whose source repository differs from the manifest's `repository`.
function repositoryProblems(repository: unknown, directory: string): string[] {
  const expected = `{ "type": "git", "url": "${REPOSITORY_URL}", "directory": "${directory}" }`;

  if (
    !isJsonRecord(repository) ||
    repository.url !== REPOSITORY_URL ||
    repository.directory !== directory
  )
    return [
      `package.json \`repository\` must be ${expected}: npm checks it against the provenance statement`,
    ];

  return [];
}
