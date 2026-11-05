// The commits the release pushes to the PHP mirrors, from the splits of scripts/php-split.sh: each mirror's `main`
// is its split, and its tag `v<version>` is one release commit on the split that adds the repository's LICENSE (no
// php/<name> holds a copy) and, for seampact/ir, writes the release's `resources/binaries.json`. The commit sits on
// the tag only, so the next split still extends `main`. It takes the source commit's date and a fixed author, so a
// rerun on the same commit makes the same one. Each mirror's commits go into `<out>/<mirror>.bundle`,
// and the manifest lists the split, release commit and tree of each: the publish job pushes exactly these.
//   node scripts/release/php/mirror-commits.ts <splits.txt> --version <version> --pins <binaries.json> --out <dir>
//     --manifest <file> [--source <commit>] [--root <dir>]
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isJsonRecord } from "../json-record.ts";
import { parsedArguments, ROOT_OPTION, repositoryRoot, runReleaseCommand } from "../release-cli.ts";
import { ReleaseError, releaseVersion } from "../release-version.ts";

const VENDOR = "seampact";
const PINNED_PACKAGE = "ir";
const PINS_PATH = "resources/binaries.json";

export const LICENSE_PATH = "LICENSE";
const MIRROR_REF_NAMESPACE = "refs/mirrors";
const RELEASE_AUTHOR_NAME = "seampact release";
const RELEASE_AUTHOR_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
const PACKAGE_NAME = /^[a-z0-9-]+$/;
const GIT_OBJECT_ID = /^[0-9a-f]{40}$/;

export interface MirrorManifestEntry {
  /** The Composer package, `seampact/<name>`. */
  readonly package: string;
  /** The mirror repository, `seampact-<name>`. */
  readonly mirror: string;
  /** The split commit, the mirror's `main`. */
  readonly split: string;
  /** The commit the tag `v<version>` points at. */
  readonly release: string;
  /** The tree of the release commit: a tag already on the mirror at this tree is the same release. */
  readonly tree: string;
}

export interface MirrorCommitsInput {
  readonly root: string;
  readonly splits: string;
  readonly version: string;
  readonly pins: string;
  readonly source: string;
  readonly out: string;
}

export const mirrorRef = (mirror: string, ref: "main" | "release") =>
  `${MIRROR_REF_NAMESPACE}/${mirror}/${ref}`;

export const mirrorBundle = (mirror: string) => `${mirror}.bundle`;

export function git(
  root: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Writes each mirror's bundle into `out` and returns the manifest; refuses a split list it cannot read by name. */
export function mirrorCommits(input: MirrorCommitsInput): MirrorManifestEntry[] {
  const splits = parsedSplits(input.splits);

  rmSync(input.out, { recursive: true, force: true });
  mkdirSync(input.out, { recursive: true });

  return splits.map(([name, split]) => {
    const mirror = `${VENDOR}-${name}`;
    const composerName = splitPackageName(input.root, split, name);
    const release = releaseCommit(input, name, split);

    git(input.root, ["update-ref", mirrorRef(mirror, "main"), split]);
    git(input.root, ["update-ref", mirrorRef(mirror, "release"), release]);
    git(input.root, [
      "bundle",
      "create",
      "--quiet",
      join(resolve(input.out), mirrorBundle(mirror)),
      mirrorRef(mirror, "main"),
      mirrorRef(mirror, "release"),
    ]);

    return {
      package: composerName,
      mirror,
      split,
      release,
      tree: git(input.root, ["rev-parse", `${release}^{tree}`]),
    };
  });
}

function parsedSplits(text: string): [string, string][] {
  const lines = text.split("\n").filter((line) => line.trim() !== "");

  if (lines.length === 0)
    throw new ReleaseError("the split list is empty: run scripts/php-split.sh first");

  return lines.map((line) => {
    const match = /^([a-z0-9-]+) ([0-9a-f]{40})$/.exec(line);

    if (match?.[1] === undefined || match[2] === undefined)
      throw new ReleaseError(
        `the split list has the line "${line}", not "<name> <commit>" as php-split.sh writes`,
      );

    return [match[1], match[2]];
  });
}

function splitPackageName(root: string, split: string, name: string): string {
  const manifest: unknown = JSON.parse(git(root, ["show", `${split}:composer.json`]));
  const composerName = isJsonRecord(manifest) ? manifest.name : undefined;
  const expected = `${VENDOR}/${name}`;

  if (composerName !== expected)
    throw new ReleaseError(
      `php/${name}/composer.json names ${JSON.stringify(composerName)}, not ${expected}: the mirror seampact-${name} holds ${expected}`,
    );

  return expected;
}

// The split's tree with the repository's LICENSE added, and for seampact/ir the release pins in place of the empty
// ones, committed on the split.
function releaseCommit(input: MirrorCommitsInput, name: string, split: string): string {
  const composerName = `${VENDOR}/${name}`;
  const licenseBlob = sourceLicenseBlob(input);
  const pinned = name === PINNED_PACKAGE;

  if (pinned) pinsInSplit(input, split);

  const index = mkdtempSync(join(tmpdir(), "mirror-index-"));

  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(index, "index") };

    git(input.root, ["read-tree", split], env);
    git(
      input.root,
      ["update-index", "--add", "--cacheinfo", `100644,${licenseBlob},${LICENSE_PATH}`],
      env,
    );

    if (pinned) {
      const pinsBlob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
        cwd: input.root,
        input: readFileSync(input.pins),
        encoding: "utf8",
      }).trim();

      git(input.root, ["update-index", "--cacheinfo", `100644,${pinsBlob},${PINS_PATH}`], env);
    }

    const tree = git(input.root, ["write-tree"], env);
    const date = git(input.root, ["show", "-s", "--format=%cI", input.source]);
    const identity = {
      GIT_AUTHOR_NAME: RELEASE_AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: RELEASE_AUTHOR_EMAIL,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: RELEASE_AUTHOR_NAME,
      GIT_COMMITTER_EMAIL: RELEASE_AUTHOR_EMAIL,
      GIT_COMMITTER_DATE: date,
    };
    const message = pinned
      ? `Release ${composerName} ${input.version}: add the license and pin the compiler binaries.`
      : `Release ${composerName} ${input.version}: add the license.`;

    return git(input.root, ["commit-tree", tree, "-p", split, "-m", message], {
      ...process.env,
      ...identity,
    });
  } catch (error) {
    throw new ReleaseError(
      `the release commit of ${composerName} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    rmSync(index, { recursive: true, force: true });
  }
}

// The repository's LICENSE at the source commit: every mirror ships it, though no php/<name> holds a copy.
function sourceLicenseBlob(input: MirrorCommitsInput): string {
  try {
    return git(input.root, ["rev-parse", "--verify", "--quiet", `${input.source}:${LICENSE_PATH}`]);
  } catch {
    throw new ReleaseError(
      `the source commit ${input.source} has no ${LICENSE_PATH} at the repository root: every mirror ships it`,
    );
  }
}

function pinsInSplit(input: MirrorCommitsInput, split: string): void {
  try {
    git(input.root, ["cat-file", "-e", `${split}:${PINS_PATH}`]);
  } catch {
    throw new ReleaseError(
      `the split of ${VENDOR}/${PINNED_PACKAGE} has no ${PINS_PATH}: php/${PINNED_PACKAGE} must hold the empty pins the release replaces`,
    );
  }
}

/** The PHP packages of the repository, as scripts/php-split.sh splits them: every `php/<name>` with a composer.json. */
export function phpPackageNames(root: string): string[] {
  return readdirSync(join(root, "php"), { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(root, "php", entry.name, "composer.json")),
    )
    .map((entry) => entry.name)
    .sort();
}

/**
 * The manifest lists each package of the repository once, as `seampact/<name>` on the mirror `seampact-<name>`, with
 * 40-hex commits and trees; any other mirror is refused, so a manifest never names a remote the release does not own.
 */
export function mirrorManifestProblems(
  manifest: readonly MirrorManifestEntry[],
  packageNames: readonly string[],
): string[] {
  const problems: string[] = [];

  for (const [position, entry] of manifest.entries()) {
    const name = entry.mirror.startsWith(`${VENDOR}-`) ? entry.mirror.slice(VENDOR.length + 1) : "";

    if (!PACKAGE_NAME.test(name) || !packageNames.includes(name))
      problems.push(
        `entry ${position} names the mirror ${JSON.stringify(entry.mirror)}, not one of ${packageNames.map((known) => `${VENDOR}-${known}`).join(", ")}`,
      );
    else if (entry.package !== `${VENDOR}/${name}`)
      problems.push(
        `entry ${position} puts ${JSON.stringify(entry.package)} on ${entry.mirror}, which holds ${VENDOR}/${name}`,
      );

    for (const field of ["split", "release", "tree"] as const)
      if (!GIT_OBJECT_ID.test(entry[field]))
        problems.push(
          `entry ${position} has the ${field} ${JSON.stringify(entry[field])}, not a 40-hex id`,
        );
  }

  for (const name of packageNames) {
    const count = manifest.filter((entry) => entry.mirror === `${VENDOR}-${name}`).length;

    if (count !== 1) problems.push(`${VENDOR}-${name} is listed ${count} times, not once`);
  }

  return problems;
}

export function parsedMirrorManifest(
  text: string,
  source: string,
  packageNames: readonly string[],
): MirrorManifestEntry[] {
  const refused = (problem: string) =>
    new ReleaseError(`${source} is not the mirror manifest split-php writes: ${problem}`);
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw refused(error instanceof Error ? error.message : String(error));
  }

  if (!Array.isArray(parsed) || parsed.length === 0) throw refused("not a non-empty array");

  const manifest = parsed.map((entry: unknown, position): MirrorManifestEntry => {
    const {
      package: composerName,
      mirror,
      split,
      release,
      tree,
    } = isJsonRecord(entry) ? entry : {};

    if (
      typeof composerName !== "string" ||
      typeof mirror !== "string" ||
      typeof split !== "string" ||
      typeof release !== "string" ||
      typeof tree !== "string"
    )
      throw refused(`entry ${position} has no string package, mirror, split, release and tree`);

    return { package: composerName, mirror, split, release, tree };
  });
  const problems = mirrorManifestProblems(manifest, packageNames);

  if (problems.length > 0) throw refused(problems.join("; "));

  return manifest;
}

/** The bundle directory holds exactly one bundle per mirror of the manifest. */
export function bundleProblems(
  directory: string,
  manifest: readonly MirrorManifestEntry[],
): string[] {
  const present = readdirSync(directory);
  const expected = manifest.map((entry) => mirrorBundle(entry.mirror));

  return [
    ...present
      .filter((file) => !expected.includes(file))
      .map((file) => `${file} is in the artefact, but not in the manifest`),
    ...expected
      .filter((file) => !present.includes(file))
      .map((file) => `${file} is in the manifest, but not in the artefact`),
  ];
}

const USAGE =
  "node scripts/release/php/mirror-commits.ts <splits.txt> --version <version> --pins <binaries.json> --out <dir> " +
  "--manifest <file> [--source <commit>] [--root <dir>]";

if (import.meta.main)
  await runReleaseCommand("mirror-commits", () => {
    const { values, positionals } = parsedArguments(
      {
        ...ROOT_OPTION,
        version: { type: "string" },
        pins: { type: "string" },
        out: { type: "string" },
        manifest: { type: "string" },
        source: { type: "string" },
      },
      USAGE,
    );
    const splits = positionals[0];

    if (
      splits === undefined ||
      values.pins === undefined ||
      values.out === undefined ||
      values.manifest === undefined
    )
      throw new ReleaseError(
        `the split list, --pins, --out and --manifest are required; usage: ${USAGE}`,
      );

    const manifest = mirrorCommits({
      root: repositoryRoot(values.root),
      splits: readFileSync(splits, "utf8"),
      version: releaseVersion(values.version),
      pins: values.pins,
      source: values.source ?? "HEAD",
      out: values.out,
    });

    writeFileSync(values.manifest, JSON.stringify(manifest));

    for (const entry of manifest)
      console.log(
        `mirror-commits: ${entry.package} tags ${entry.release} (tree ${entry.tree}) on ${entry.mirror}`,
      );
  });
