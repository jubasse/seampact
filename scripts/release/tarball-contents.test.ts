import { describe, expect, it } from "vitest";
import { type PackedPackage, REPOSITORY_URL, tarballProblems } from "./tarball-contents.ts";

const DIRECTORY = "packages/core/cli";
const EXPECTED = { name: "@seampact/cli", version: "1.2.3" };

const PUBLISHABLE_MANIFEST = {
  name: "@seampact/cli",
  version: "1.2.3",
  repository: { type: "git", url: REPOSITORY_URL, directory: DIRECTORY },
  dependencies: { "@seampact/spec": "1.2.3", yaml: "2.9.1" },
};

// The tree `pnpm pack` writes for a built package: its tracked README, the copied LICENSE, the manifest and `dist/`.
function packed(overrides: Partial<PackedPackage> = {}): PackedPackage {
  return {
    directory: DIRECTORY,
    files: ["LICENSE", "README.md", "package.json", "dist/index.js", "dist/index.d.ts"],
    manifest: PUBLISHABLE_MANIFEST,
    trackedFiles: new Set(["README.md", "package.json", "src/index.ts"]),
    ...overrides,
  };
}

describe("the npm tarball content check", () => {
  it("accepts tracked files, the build output and the files pnpm writes", () => {
    expect(tarballProblems(packed(), EXPECTED)).toEqual([]);
  });

  it("refuses tests, fixtures and build caches, even when git tracks them", () => {
    const files = [
      "LICENSE",
      "README.md",
      "dist/index.test.js",
      "dist/bundle/reference-tarball.test-support.js",
      "test/fixtures/contract.yaml",
      "dist/tsconfig.build.tsbuildinfo",
    ];
    const problems = tarballProblems(packed({ files, trackedFiles: new Set(files) }), EXPECTED);

    expect(problems).toEqual(
      files
        .slice(2)
        .map((file) => `${file} is a test, fixture or build-cache file: leave it out of \`files\``),
    );
  });

  it("refuses a file git does not track outside the build output", () => {
    const problems = tarballProblems(packed({ files: ["LICENSE", "README.md", ".env"] }), EXPECTED);

    expect(problems).toEqual([
      ".env is neither a tracked file nor build output (git-ignored or stray): leave it out of `files`",
    ]);
  });

  it("requires the LICENSE and the README", () => {
    const problems = tarballProblems(
      packed({ files: ["package.json", "dist/index.js"] }),
      EXPECTED,
    );

    expect(problems).toEqual([
      "LICENSE is missing: add it to the package (pnpm copies the workspace LICENSE only)",
      "README.md is missing: add it to the package (pnpm copies the workspace LICENSE only)",
    ]);
  });

  it("refuses a manifest the stamp did not write, a local specifier and a foreign repository", () => {
    const manifest = {
      name: "@seampact/cli",
      version: "0.0.0",
      private: true,
      repository: { type: "git", url: "https://example.com/fork.git", directory: DIRECTORY },
      peerDependencies: { "@seampact/spec": "workspace:*" },
    };
    const problems = tarballProblems(packed({ manifest }), EXPECTED);

    expect(problems).toEqual([
      'package.json is at "0.0.0", not 1.2.3: run the stamp',
      "package.json is still `private`: run the stamp",
      "package.json peerDependencies keeps the local specifier @seampact/spec@workspace:*: pack it with pnpm",
      `package.json \`repository\` must be { "type": "git", "url": "${REPOSITORY_URL}", "directory": "${DIRECTORY}" }: npm checks it against the provenance statement`,
    ]);
  });
});
