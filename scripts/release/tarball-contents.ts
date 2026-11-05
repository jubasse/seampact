// The content check of an npm tarball before it is published: only the package's own tracked files and its build
// output, no test or fixture, the LICENSE and README present, and a manifest at the release version that npm can
// publish with provenance.
import { BUILD_DIRECTORY } from "../consumers/packed-packages.ts";
import { isJsonRecord } from "./json-record.ts";

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
const DEPENDENCY_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "devDependencies",
];
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
}

export interface ExpectedPackage {
  readonly name: string;
  readonly version: string;
}

/** One line per problem, each naming the file or field; empty when the tarball can be published. */
export function tarballProblems(packed: PackedPackage, expected: ExpectedPackage): string[] {
  return [...fileProblems(packed), ...manifestProblems(packed, expected)];
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

  problems.push(...repositoryProblems(manifest.repository, packed.directory));

  return problems;
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
