import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GOLDEN_TREES, generatedVersionEdits } from "./generated-versions.ts";
import { ReleaseError } from "./release-version.ts";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// The version the committed goldens carry; test vectors at other versions are not the stamp's business.
const STAMPED_VERSION = "1.0.0";

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  })
    .split("\0")
    .filter((file) => file !== "");
}

function isUnderGoldenTree(file: string): boolean {
  return GOLDEN_TREES.some((tree) => file.startsWith(`${tree.directory}/`));
}

function carriesGeneratorVersion(file: string): boolean {
  const content = readFileSync(join(REPOSITORY_ROOT, file), "utf8");

  return GOLDEN_TREES.some(
    (tree) =>
      file.endsWith(tree.form.extension) &&
      [...content.matchAll(tree.form.line)].some((match) => match[2] === STAMPED_VERSION),
  );
}

describe("generated versions", () => {
  it("finds every tracked file that embeds a generator version inside a golden tree", () => {
    const outside = trackedFiles()
      .filter((file) => !isUnderGoldenTree(file))
      .filter(carriesGeneratorVersion);

    expect(outside, "add the tree to GOLDEN_TREES").toEqual([]);
  });

  it("refuses a missing golden directory by name", () => {
    const root = mkdtempSync(join(tmpdir(), "seampact-stamp-"));

    try {
      cpSync(join(REPOSITORY_ROOT, "fixtures/golden"), join(root, "fixtures/golden"), {
        recursive: true,
      });

      expect(() => generatedVersionEdits(root, "1.0.0")).toThrow(ReleaseError);
      expect(() => generatedVersionEdits(root, "1.0.0")).toThrow(
        /python\/drf\/drf_tests\/golden does not exist/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
