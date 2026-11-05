import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PACKED_PACKS } from "../consumers/packed-packages.ts";
import { PUBLISHED_PACKAGES, UNPUBLISHED_PACKAGES } from "./npm-versions.ts";
import { ReleaseError, releaseVersion } from "./release-version.ts";
import { type VersionEdit, writeVersionEdit } from "./version-edit.ts";
import { pendingVersionChanges, releaseVersionEdits } from "./version-plan.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEVELOPMENT_VERSION = "0.0.0";
const RELEASE = "1.2.3";

const HOOKS_PROJECT = `[project]
name = "seampact-hooks"
version = "0.0.0"
`;

const CODEGEN_PROJECT = `[project]
name = "seampact-codegen"
version = "0.0.0"
# The hooks pin.
dependencies = ["django>=5.2", "seampact-hooks==0.0.0"]

[project.optional-dependencies]
generate = [
    "seampact-hooks[extra]==0.0.0; python_version >= '3.12'",
]

[tool.uv.sources]
seampact-hooks = { workspace = true }
`;

const UV_LOCK = `version = 1

[[package]]
name = "seampact-codegen"
version = "0.0.0"
source = { editable = "codegen" }

[[package]]
name = "seampact-hooks"
version = "0.0.0"
source = { editable = "hooks" }
`;

const GRADLE_PROPERTIES = "org.gradle.caching=true\n";

// The layout the formatter gives the file: the `fixed` group on one line.
const CHANGESET_CONFIG = `{
  "access": "restricted",
  "baseBranch": "develop",
  "fixed": [["@seampact/*"]]
}
`;

const PACK_MANIFEST = `# A pack.
pack: { name: '@seampact/pack-hal', version: 0.0.0, extends: [] }
conventions: {}
`;

// Each runtime constant in the form of its source file, at its development version.
const RUNTIME_SOURCES: Record<string, string> = {
  "packages/runtime/server-runtime/src/version.ts":
    '// The version.\nexport const SERVER_RUNTIME_VERSION = "0.0.0";\n',
  "python/codegen/src/seampact/codegen/runtime/version.py":
    'from typing import Final\n\nRUNTIME_VERSION: Final = "0.0.0-dev"\nOTHER: Final = "0.0.0-dev"\n',
  "php/codegen/runtime/RuntimeVersion.php":
    "<?php\nfinal class RuntimeVersion\n{\n    public const VERSION = '0.0.0-dev';\n}\n",
};

const trees: string[] = [];

afterEach(() => {
  for (const tree of trees.splice(0)) rmSync(tree, { recursive: true, force: true });
});

function writeTreeFile(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

// A repository with every workspace package of the release lists, two Python projects and their lock.
function developmentTree(): string {
  const root = mkdtempSync(join(tmpdir(), "release-stamp-"));

  trees.push(root);

  for (const directory of [...PUBLISHED_PACKAGES, ...UNPUBLISHED_PACKAGES]) {
    const pack = PACKED_PACKS.includes(directory) ? { seampact: { pack: "pack.yaml" } } : {};
    const manifest = {
      name: `@seampact/${directory.split("/").at(-1)}`,
      version: DEVELOPMENT_VERSION,
      private: true,
      ...pack,
    };

    writeTreeFile(root, `${directory}/package.json`, `${JSON.stringify(manifest, null, 2)}\n`);

    if (PACKED_PACKS.includes(directory))
      writeTreeFile(root, `${directory}/pack.yaml`, PACK_MANIFEST);
  }

  for (const [file, text] of Object.entries(RUNTIME_SOURCES)) writeTreeFile(root, file, text);

  writeTreeFile(root, ".changeset/config.json", CHANGESET_CONFIG);
  writeTreeFile(root, "jvm/gradle.properties", GRADLE_PROPERTIES);
  writeTreeFile(root, "python/hooks/pyproject.toml", HOOKS_PROJECT);
  writeTreeFile(root, "python/codegen/pyproject.toml", CODEGEN_PROJECT);
  writeTreeFile(root, "python/uv.lock", UV_LOCK);

  return root;
}

function stamp(root: string, version: string): VersionEdit[] {
  const edits = releaseVersionEdits(root, version);

  for (const edit of edits) writeVersionEdit(root, edit);

  return edits;
}

const readTreeFile = (root: string, file: string) => readFileSync(join(root, file), "utf8");

describe("the release stamp", () => {
  it("writes every version field, after which the version check finds nothing and a second stamp changes nothing", () => {
    const root = developmentTree();

    stamp(root, RELEASE);

    expect(pendingVersionChanges(releaseVersionEdits(root, RELEASE))).toEqual([]);
    expect(stamp(root, RELEASE).every((edit) => edit.before === edit.after)).toBe(true);
  });

  it("drops `private` from the published packages only", () => {
    const root = developmentTree();

    stamp(root, RELEASE);

    const cli = JSON.parse(readTreeFile(root, "packages/core/cli/package.json"));
    const binary = JSON.parse(readTreeFile(root, "packages/tools/binary/package.json"));

    expect(cli).toEqual({ name: "@seampact/cli", version: RELEASE });
    expect(binary).toEqual({ name: "@seampact/binary", version: RELEASE, private: true });
  });

  it("makes the changesets access public and keeps the file's layout", () => {
    const root = developmentTree();

    stamp(root, RELEASE);

    expect(readTreeFile(root, ".changeset/config.json")).toBe(
      CHANGESET_CONFIG.replace('"restricted"', '"public"'),
    );
  });

  it("writes the version of every pack manifest, and keeps the rest of the YAML", () => {
    const root = developmentTree();

    stamp(root, RELEASE);

    for (const directory of PACKED_PACKS)
      expect(readTreeFile(root, `${directory}/pack.yaml`)).toBe(
        PACK_MANIFEST.replace("version: 0.0.0", `version: ${RELEASE}`),
      );
  });

  it("writes the version constant of each runtime, and that constant only", () => {
    const root = developmentTree();

    stamp(root, RELEASE);

    expect(readTreeFile(root, "packages/runtime/server-runtime/src/version.ts")).toContain(
      `export const SERVER_RUNTIME_VERSION = "${RELEASE}";`,
    );
    expect(readTreeFile(root, "python/codegen/src/seampact/codegen/runtime/version.py")).toBe(
      `from typing import Final\n\nRUNTIME_VERSION: Final = "${RELEASE}"\nOTHER: Final = "0.0.0-dev"\n`,
    );
    expect(readTreeFile(root, "php/codegen/runtime/RuntimeVersion.php")).toContain(
      `    public const VERSION = '${RELEASE}';`,
    );
  });

  it("refuses a pack manifest or a runtime constant it cannot read, by file", () => {
    const blockPack = developmentTree();

    writeTreeFile(
      blockPack,
      "packages/packs/pack-hal/pack.yaml",
      "pack:\n  name: '@seampact/pack-hal'\n  version: 0.0.0\n",
    );

    expect(() => releaseVersionEdits(blockPack, RELEASE)).toThrow(
      "packages/packs/pack-hal/pack.yaml has no line the stamp can read pack.version from",
    );

    const noConstant = developmentTree();

    rmSync(join(noConstant, "php/codegen/runtime/RuntimeVersion.php"));

    expect(() => releaseVersionEdits(noConstant, RELEASE)).toThrow(
      "php/codegen/runtime/RuntimeVersion.php does not exist: the stamp writes RuntimeVersion::VERSION there",
    );
  });

  it("pins the seampact requirements, keeps the others and the comments, and updates the lock", () => {
    const root = developmentTree();

    stamp(root, RELEASE);

    expect(readTreeFile(root, "python/codegen/pyproject.toml")).toBe(
      CODEGEN_PROJECT.replaceAll("0.0.0", RELEASE),
    );
    expect(readTreeFile(root, "python/uv.lock")).toBe(
      UV_LOCK.replaceAll(`version = "0.0.0"`, `version = "${RELEASE}"`),
    );
    expect(readTreeFile(root, "jvm/gradle.properties")).toBe(
      `${GRADLE_PROPERTIES}\n# The release version of every module, written by scripts/release/stamp.ts.\nversion=${RELEASE}\n`,
    );
  });

  it("reads a CRLF checkout and writes each file back with its own line endings", () => {
    const lfRoot = developmentTree();
    const crlfRoot = developmentTree();
    const files = releaseVersionEdits(lfRoot, RELEASE).map((edit) => edit.file);

    for (const file of files)
      writeTreeFile(crlfRoot, file, readTreeFile(crlfRoot, file).replaceAll("\n", "\r\n"));

    stamp(crlfRoot, RELEASE);
    stamp(lfRoot, RELEASE);

    for (const file of files)
      expect(readTreeFile(crlfRoot, file)).toBe(
        readTreeFile(lfRoot, file).replaceAll("\n", "\r\n"),
      );
  });

  it("replaces a version property already there", () => {
    const root = developmentTree();

    writeTreeFile(root, "jvm/gradle.properties", "version=1.0.0\norg.gradle.caching=true\n");
    stamp(root, RELEASE);

    expect(readTreeFile(root, "jvm/gradle.properties")).toBe(
      `version=${RELEASE}\norg.gradle.caching=true\n`,
    );
  });

  it("refuses a package that is neither published nor unpublished, by name", () => {
    const root = developmentTree();

    writeTreeFile(root, "packages/tools/stray/package.json", `{ "name": "@seampact/stray" }\n`);

    expect(() => releaseVersionEdits(root, RELEASE)).toThrow(
      /packages\/tools\/stray is neither published nor/,
    );
  });

  it("refuses a range on a seampact distribution, and a lock without a member", () => {
    const ranged = developmentTree();

    writeTreeFile(
      ranged,
      "python/codegen/pyproject.toml",
      CODEGEN_PROJECT.replace("seampact-hooks==", "seampact-hooks>="),
    );

    expect(() => releaseVersionEdits(ranged, RELEASE)).toThrow(
      'python/codegen/pyproject.toml: the requirement "seampact-hooks>=0.0.0" on a seampact distribution',
    );

    const unlocked = developmentTree();

    writeTreeFile(
      unlocked,
      "python/uv.lock",
      UV_LOCK.split('\n\n[[package]]\nname = "seampact-hooks"')[0] ?? "",
    );

    expect(() => releaseVersionEdits(unlocked, RELEASE)).toThrow(
      "python/uv.lock has no editable entry for seampact-hooks",
    );
  });
});

describe("the version check", () => {
  it("names each field of a development checkout that is not at the release", () => {
    const pending = pendingVersionChanges(releaseVersionEdits(developmentTree(), RELEASE));

    expect(pending).toContain(
      `packages/core/cli/package.json: version is "0.0.0", not "${RELEASE}"`,
    );
    expect(pending).toContain(
      "packages/core/cli/package.json: a published package is still `private`",
    );
    expect(pending).not.toContain(
      "packages/tools/binary/package.json: a published package is still `private`",
    );
    expect(pending).toContain('.changeset/config.json: access is "restricted", not "public"');
    expect(pending).toContain(
      `packages/packs/pack-spring/pack.yaml: pack.version is "0.0.0", not "${RELEASE}"`,
    );
    expect(pending).toContain(
      `packages/runtime/server-runtime/src/version.ts: SERVER_RUNTIME_VERSION is "0.0.0", not "${RELEASE}"`,
    );
    expect(pending).toContain(
      `python/codegen/src/seampact/codegen/runtime/version.py: RUNTIME_VERSION is "0.0.0-dev", not "${RELEASE}"`,
    );
    expect(pending).toContain(
      `php/codegen/runtime/RuntimeVersion.php: RuntimeVersion::VERSION is "0.0.0-dev", not "${RELEASE}"`,
    );
    expect(pending).toContain("jvm/gradle.properties: has no `version` property");
    expect(pending).toContain(
      `python/codegen/pyproject.toml: requirement "seampact-hooks==0.0.0" does not pin ${RELEASE}`,
    );
    expect(pending).toContain(
      `python/uv.lock: seampact-hooks is locked at "0.0.0", not "${RELEASE}"`,
    );
  });

  it("fails with exit code 1 and the stamp command on a checkout not at the release", () => {
    const result = spawnSync(
      process.execPath,
      [join(HERE, "check-version.ts"), RELEASE, "--root", developmentTree()],
      {
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`run \`node scripts/release/stamp.ts ${RELEASE}\``);
  });

  it("accepts MAJOR.MINOR.PATCH only", () => {
    expect(releaseVersion("1.0.0")).toBe("1.0.0");

    for (const refused of ["", "1.0", "01.0.0", "1.0.0-rc.1", "v1.0.0"])
      expect(() => releaseVersion(refused)).toThrow(ReleaseError);
  });
});
