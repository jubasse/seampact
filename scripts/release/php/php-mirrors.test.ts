import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  git,
  type MirrorManifestEntry,
  mirrorCommits,
  parsedMirrorManifest,
  phpPackageNames,
} from "./mirror-commits.ts";
import { mirrorRemote, pushMirrors } from "./push-mirrors.ts";

const VERSION = "1.2.3";
const SPLIT_SCRIPT = resolve(import.meta.dirname, "../../php-split.sh");
const EMPTY_PINS = '{ "version": null, "sha256": {} }\n';
const RELEASE_PINS = '{ "version": "1.2.3", "sha256": { "seampact-linux-x64": "aa" } }\n';
const IDENTITY = {
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@invalid",
};

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const temporaryDirectory = (prefix: string) => {
  const directory = mkdtempSync(join(tmpdir(), prefix));

  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));

  return directory;
};

function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
}

function commit(root: string, message: string, date: string): void {
  const env = { ...process.env, ...IDENTITY, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };

  git(root, ["add", "--all"], env);
  git(root, ["commit", "--quiet", "-m", message], env);
}

// A monorepo with seampact/ir (holding the empty pins unless told otherwise) and seampact/hooks, each changed in
// its own commit.
function monorepo(
  irName = "seampact/ir",
  irFiles: Readonly<Record<string, string>> = { "php/ir/resources/binaries.json": EMPTY_PINS },
): string {
  const root = temporaryDirectory("php-mirrors-repo-");

  git(root, ["init", "--quiet", "--initial-branch=develop"]);
  writeFiles(root, {
    "README.md": "monorepo\n",
    "php/ir/composer.json": JSON.stringify({ name: irName }),
    ...irFiles,
    "php/hooks/composer.json": JSON.stringify({ name: "seampact/hooks" }),
  });
  commit(root, "Add the PHP packages.", "2026-11-01T10:00:00Z");
  writeFiles(root, { "php/hooks/src/Hook.php": "<?php\n", "packages/other.ts": "" });
  commit(root, "Add a hook.", "2026-11-02T10:00:00Z");

  return root;
}

function split(root: string): { splits: string; out: string } {
  const out = join(temporaryDirectory("php-mirrors-split-"), "split");

  execFileSync(SPLIT_SCRIPT, [out], { cwd: root, stdio: "pipe" });

  return { splits: readFileSync(join(out, "splits.txt"), "utf8"), out };
}

function releaseCommits(
  root: string,
  // null leaves the pins file unwritten.
  pins: string | null = RELEASE_PINS,
): { manifest: MirrorManifestEntry[]; bundles: string } {
  const pinsFile = join(temporaryDirectory("php-mirrors-pins-"), "binaries.json");
  const bundles = temporaryDirectory("php-mirrors-bundles-");

  if (pins !== null) writeFileSync(pinsFile, pins);

  const manifest = mirrorCommits({
    root,
    splits: split(root).splits,
    version: VERSION,
    pins: pinsFile,
    source: "HEAD",
    out: bundles,
  });

  return { manifest, bundles };
}

// One empty bare repository per mirror, as the user creates them before the first release.
function bareMirrors(names: readonly string[]): string {
  const base = temporaryDirectory("php-mirrors-remotes-");

  for (const name of names) git(base, ["init", "--quiet", "--bare", `${name}.git`]);

  return base;
}

const remoteRef = (base: string, mirror: string, ref: string) =>
  git(base, ["--git-dir", `${mirror}.git`, "rev-parse", "--verify", "--quiet", ref]);

describe("the PHP split", () => {
  it("splits each package with composer.json at the root of its tree, the same commits on every run", () => {
    const root = monorepo();
    const first = split(root);
    const lines = first.splits.trim().split("\n");

    expect(lines.map((line) => line.split(" ")[0])).toEqual(["hooks", "ir"]);
    expect(readFileSync(join(first.out, "trees/hooks/composer.json"), "utf8")).toContain(
      "seampact/hooks",
    );
    expect(readFileSync(join(first.out, "trees/hooks/src/Hook.php"), "utf8")).toBe("<?php\n");
    expect(split(root).splits).toBe(first.splits);
  });
});

describe("the mirror commits", () => {
  it("tags each split, except seampact/ir's, one commit on its split that writes the release pins", () => {
    const root = monorepo();
    const { manifest } = releaseCommits(root);
    const [hooks, ir] = manifest;

    expect(manifest.map((entry) => [entry.package, entry.mirror])).toEqual([
      ["seampact/hooks", "seampact-hooks"],
      ["seampact/ir", "seampact-ir"],
    ]);
    expect(hooks?.release).toBe(hooks?.split);
    expect(ir?.release).not.toBe(ir?.split);
    expect(git(root, ["rev-parse", `${ir?.release}^`])).toBe(ir?.split);
    expect(git(root, ["show", `${ir?.release}:resources/binaries.json`])).toBe(RELEASE_PINS.trim());
    expect(git(root, ["show", `${ir?.split}:resources/binaries.json`])).toBe(EMPTY_PINS.trim());
  });

  it("makes the same pin commit on a rerun of the same source commit", () => {
    const root = monorepo();

    expect(releaseCommits(root).manifest).toEqual(releaseCommits(root).manifest);
  });

  it("names the cause of a failed pin commit: no pins in the split, or a pins file it cannot read", () => {
    expect(() => releaseCommits(monorepo("seampact/ir", {}))).toThrow(
      "the split of seampact/ir has no resources/binaries.json",
    );
    expect(() => releaseCommits(monorepo(), null)).toThrow(
      /the pin commit of seampact\/ir failed: ENOENT[^\n]*binaries\.json/,
    );
  });

  it("reads back its manifest, and refuses one naming a mirror or a commit the release does not own", () => {
    const root = monorepo();
    const { manifest } = releaseCommits(root);
    const names = phpPackageNames(root);
    const [hooks, ir] = manifest;
    const parsed = (entries: readonly unknown[]) =>
      parsedMirrorManifest(JSON.stringify(entries), "mirrors.json", names);

    expect(names).toEqual(["hooks", "ir"]);
    expect(parsed(manifest)).toEqual(manifest);
    expect(() => parsed([hooks, { ...ir, mirror: "attacker-repo" }])).toThrow(
      /entry 1 names the mirror "attacker-repo", not one of seampact-hooks, seampact-ir/,
    );
    expect(() => parsed([hooks, { ...ir, package: "acme/ir" }])).toThrow(
      /entry 1 puts "acme\/ir" on seampact-ir, which holds seampact\/ir/,
    );
    expect(() => parsed([hooks, { ...ir, split: "main" }])).toThrow(
      /entry 1 has the split "main", not a 40-hex id/,
    );
    expect(() => parsed([hooks])).toThrow(/seampact-ir is listed 0 times, not once/);
  });

  it("refuses a package whose composer.json names another package than its mirror's", () => {
    expect(() => releaseCommits(monorepo("acme/ir"))).toThrow(
      'php/ir/composer.json names "acme/ir", not seampact/ir: the mirror seampact-ir holds seampact/ir',
    );
  });
});

describe("the mirror push", () => {
  const mirrors = ["seampact-hooks", "seampact-ir"];

  it("pushes main and the tag to every mirror, then skips each one already at the release tree", () => {
    const root = monorepo();
    const { manifest, bundles } = releaseCommits(root);
    const base = bareMirrors(mirrors);
    const first = pushMirrors({ bundles, manifest, version: VERSION, remoteBase: base });

    expect(first.toPush.map((entry) => entry.mirror)).toEqual(mirrors);

    for (const entry of manifest) {
      expect(remoteRef(base, entry.mirror, "refs/heads/main")).toBe(entry.split);
      expect(remoteRef(base, entry.mirror, `refs/tags/v${VERSION}`)).toBe(entry.release);
    }

    const second = pushMirrors({ bundles, manifest, version: VERSION, remoteBase: base });

    expect(second.toPush).toEqual([]);
    expect(second.alreadyTagged.map((entry) => entry.mirror)).toEqual(mirrors);
  });

  it("skips a tag at the release tree even when its commit differs, as a rerun on a later date makes", () => {
    const root = monorepo();
    const { manifest, bundles } = releaseCommits(root);
    const base = bareMirrors(mirrors);

    pushMirrors({ bundles, manifest, version: VERSION, remoteBase: base });
    writeFiles(root, { "README.md": "changed\n" });
    commit(root, "Change the readme.", "2026-11-03T10:00:00Z");

    const rerun = releaseCommits(root);

    expect(rerun.manifest[1]?.release).not.toBe(manifest[1]?.release);
    expect(
      pushMirrors({ ...rerun, version: VERSION, remoteBase: base }).alreadyTagged,
    ).toHaveLength(2);
  });

  it("never forces a mirror's main: one the split does not extend is refused, with nothing written to it", () => {
    const root = monorepo();
    const { manifest, bundles } = releaseCommits(root);
    const base = bareMirrors(mirrors);
    const irSplit = manifest[1]?.split ?? "";
    const unrelated = git(root, ["commit-tree", `${irSplit}^{tree}`, "-m", "Edited by hand."], {
      ...process.env,
      ...IDENTITY,
    });

    git(root, ["push", "--quiet", join(base, "seampact-ir.git"), `${unrelated}:refs/heads/main`]);

    expect(() => pushMirrors({ bundles, manifest, version: VERSION, remoteBase: base })).toThrow(
      /git could not push seampact\/ir to [^\n]*seampact-ir\.git/,
    );
    expect(remoteRef(base, "seampact-ir", "refs/heads/main")).toBe(unrelated);
    expect(() => remoteRef(base, "seampact-ir", `refs/tags/v${VERSION}`)).toThrow();
    expect(remoteRef(base, "seampact-hooks", `refs/tags/v${VERSION}`)).toBe(manifest[0]?.release);
  });

  it("fails by name, before pushing anything, on a tag at another tree", () => {
    const root = monorepo();
    const base = bareMirrors(mirrors);
    const published = releaseCommits(root);

    pushMirrors({ ...published, version: VERSION, remoteBase: base });
    git(base, ["--git-dir", "seampact-hooks.git", "tag", "--delete", `v${VERSION}`]);

    const other = releaseCommits(
      root,
      '{ "version": "1.2.3", "sha256": { "seampact-linux-x64": "bb" } }\n',
    );

    expect(() => pushMirrors({ ...other, version: VERSION, remoteBase: base })).toThrow(
      new RegExp(
        `seampact-ir has v1\\.2\\.3 at the tree [0-9a-f]{40}, not this release's ${other.manifest[1]?.tree}: a published tag never moves`,
      ),
    );
    expect(git(base, ["--git-dir", "seampact-hooks.git", "tag", "--list"])).toBe("");
  });

  it("refuses commits that are not the manifest's before asking any mirror", () => {
    const root = monorepo();
    const { manifest, bundles } = releaseCommits(root);
    const tampered = manifest.map((entry) => ({ ...entry, tree: "0".repeat(40) }));

    expect(() =>
      pushMirrors({ bundles, manifest: tampered, version: VERSION, remoteBase: "/nowhere" }),
    ).toThrow(
      /the mirror commits are not the ones split-php wrote, so nothing was pushed:\n {2}seampact-hooks's release commit has the tree [0-9a-f]{40}, not 0{40}/,
    );
    expect(mirrorRemote("https://github.com/jubasse/", "seampact-ir")).toBe(
      "https://github.com/jubasse/seampact-ir.git",
    );
  });
});
