// The idempotent push of the PHP mirrors: exactly the commits of split-php's manifest, read from their bundles and
// checked against it, then for each mirror its split to `main` and the tag `v<version>` in one atomic push. A mirror
// whose tag is already at the release tree is skipped; one whose tag is at another tree fails by name before anything
// is pushed, since a published tag never moves. With PHP_MIRRORS_TOKEN set, git reads it through a credential helper
// given in the environment, so the token is never in an argument or a remote URL.
//   node scripts/release/php/push-mirrors.ts <bundle-dir> --manifest <file> --version <version> --remote-base <url>
//     [--root <dir>]
// `--remote-base` is where the mirrors live: https://github.com/jubasse, or the rehearsal's directory of bare
// repositories; a mirror's remote is `<remote-base>/<mirror>.git`.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { boundedText } from "../bounded-text.ts";
import { parsedArguments, ROOT_OPTION, repositoryRoot, runReleaseCommand } from "../release-cli.ts";
import { ReleaseError, releaseVersion } from "../release-version.ts";
import {
  bundleProblems,
  git,
  type MirrorManifestEntry,
  mirrorBundle,
  mirrorRef,
  parsedMirrorManifest,
  phpPackageNames,
} from "./mirror-commits.ts";

const TOKEN_VARIABLE = "PHP_MIRRORS_TOKEN";
// A remote's stderr reaches the error; git's own refusals are well under this.
const REMOTE_STDERR_MAX_LENGTH = 2_000;
// Reads the token from the environment when git asks; the empty helper first drops any helper of the machine.
const TOKEN_CREDENTIAL_HELPER = `!f() { test "$1" = get && printf 'username=x-access-token\\npassword=%s\\n' "$${TOKEN_VARIABLE}"; }; f`;

export interface MirrorPushPlan {
  readonly toPush: readonly MirrorManifestEntry[];
  readonly alreadyTagged: readonly MirrorManifestEntry[];
}

export interface MirrorPushInput {
  readonly bundles: string;
  readonly manifest: readonly MirrorManifestEntry[];
  readonly version: string;
  readonly remoteBase: string;
}

/** Pushes what the mirrors lack; returns the plan it followed. Throws a `ReleaseError` naming each problem. */
export function pushMirrors(input: MirrorPushInput): MirrorPushPlan {
  const work = mkdtempSync(join(tmpdir(), "push-mirrors-"));

  try {
    git(work, ["init", "--quiet", "--bare"]);
    fetchBundles(work, input);

    const plan = mirrorPushPlan(work, input);

    for (const entry of plan.toPush) pushMirror(work, input, entry);

    return plan;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export const mirrorRemote = (remoteBase: string, mirror: string) =>
  `${remoteBase.replace(/\/+$/, "")}/${mirror}.git`;

// The bundles hold exactly the listed commits: git checks every object it fetches, so a commit id pins its history.
function fetchBundles(work: string, input: MirrorPushInput): void {
  const problems = bundleProblems(input.bundles, input.manifest);

  if (problems.length > 0) throw notTheManifestCommits(problems);

  for (const entry of input.manifest) {
    const bundle = join(resolve(input.bundles), mirrorBundle(entry.mirror));

    git(work, [
      "fetch",
      "--quiet",
      "--no-tags",
      bundle,
      `${mirrorRef(entry.mirror, "main")}:${mirrorRef(entry.mirror, "main")}`,
      `${mirrorRef(entry.mirror, "release")}:${mirrorRef(entry.mirror, "release")}`,
    ]);

    const split = git(work, ["rev-parse", mirrorRef(entry.mirror, "main")]);
    const release = git(work, ["rev-parse", mirrorRef(entry.mirror, "release")]);
    const tree = git(work, ["rev-parse", `${release}^{tree}`]);

    if (split !== entry.split)
      problems.push(`${entry.mirror}'s bundle has main at ${split}, not ${entry.split}`);

    if (release !== entry.release)
      problems.push(`${entry.mirror}'s bundle has the release at ${release}, not ${entry.release}`);

    if (tree !== entry.tree)
      problems.push(`${entry.mirror}'s release commit has the tree ${tree}, not ${entry.tree}`);
  }

  if (problems.length > 0) throw notTheManifestCommits(problems);
}

const notTheManifestCommits = (problems: readonly string[]) =>
  new ReleaseError(
    `the mirror commits are not the ones split-php wrote, so nothing was pushed:\n  ${problems.join("\n  ")}`,
  );

function mirrorPushPlan(work: string, input: MirrorPushInput): MirrorPushPlan {
  const toPush: MirrorManifestEntry[] = [];
  const alreadyTagged: MirrorManifestEntry[] = [];
  const conflicts: string[] = [];
  const tag = `refs/tags/v${input.version}`;

  for (const entry of input.manifest) {
    const remote = mirrorRemote(input.remoteBase, entry.mirror);
    const listed = remoteGit(
      work,
      ["ls-remote", remote, tag],
      `ask ${remote} for v${input.version}`,
    );

    if (listed === "") {
      toPush.push(entry);
      continue;
    }

    const held = `refs/held/${entry.mirror}`;

    remoteGit(
      work,
      ["fetch", "--quiet", "--no-tags", remote, `+${tag}:${held}`],
      `fetch v${input.version} from ${remote}`,
    );

    const tree = git(work, ["rev-parse", `${held}^{tree}`]);

    if (tree === entry.tree) alreadyTagged.push(entry);
    else
      conflicts.push(
        `${entry.mirror} has v${input.version} at the tree ${tree}, not this release's ${entry.tree}`,
      );
  }

  if (conflicts.length > 0)
    throw new ReleaseError(
      `${conflicts.join("; ")}: a published tag never moves, so nothing was pushed; stamp and release a new patch version`,
    );

  return { toPush, alreadyTagged };
}

function pushMirror(work: string, input: MirrorPushInput, entry: MirrorManifestEntry): void {
  const remote = mirrorRemote(input.remoteBase, entry.mirror);

  remoteGit(
    work,
    [
      "push",
      "--quiet",
      "--atomic",
      remote,
      `${entry.split}:refs/heads/main`,
      `${entry.release}:refs/tags/v${input.version}`,
    ],
    `push ${entry.package} to ${remote} (the mirrors pushed before it stay, and a rerun skips them; a main the split ` +
      "does not extend was changed by hand: reset it to the last release's split)",
  );
}

// A git command that reaches a mirror, with the token's credential helper when the token is set.
function remoteGit(work: string, args: readonly string[], what: string): string {
  const token = process.env[TOKEN_VARIABLE];
  const credentials =
    token === undefined || token === ""
      ? {}
      : {
          GIT_CONFIG_COUNT: "2",
          GIT_CONFIG_KEY_0: "credential.helper",
          GIT_CONFIG_VALUE_0: "",
          GIT_CONFIG_KEY_1: "credential.helper",
          GIT_CONFIG_VALUE_1: TOKEN_CREDENTIAL_HELPER,
        };

  try {
    return git(work, args, { ...process.env, GIT_TERMINAL_PROMPT: "0", ...credentials });
  } catch (error) {
    const stderr =
      error instanceof Error && "stderr" in error ? String(error.stderr).trim() : String(error);

    throw new ReleaseError(
      `git could not ${what}: ${boundedText(stderr, REMOTE_STDERR_MAX_LENGTH)}`,
    );
  }
}

const USAGE =
  "node scripts/release/php/push-mirrors.ts <bundle-dir> --manifest <file> --version <version> --remote-base <url> " +
  "[--root <dir>]";

if (import.meta.main)
  await runReleaseCommand("push-mirrors", () => {
    const { values, positionals } = parsedArguments(
      {
        ...ROOT_OPTION,
        manifest: { type: "string" },
        version: { type: "string" },
        "remote-base": { type: "string" },
      },
      USAGE,
    );
    const bundles = positionals[0];
    const remoteBase = values["remote-base"];

    if (bundles === undefined || values.manifest === undefined || remoteBase === undefined)
      throw new ReleaseError(
        `the bundle directory, --manifest and --remote-base are required; usage: ${USAGE}`,
      );

    const plan = pushMirrors({
      bundles,
      manifest: parsedMirrorManifest(
        readFileSync(values.manifest, "utf8"),
        values.manifest,
        phpPackageNames(repositoryRoot(values.root)),
      ),
      version: releaseVersion(values.version),
      remoteBase,
    });

    for (const entry of plan.alreadyTagged)
      console.log(`push-mirrors: ${entry.mirror} already has this release's tag, skipped`);

    console.log(
      `push-mirrors: ${plan.toPush.length} pushed, ${plan.alreadyTagged.length} already there, on ${remoteBase}`,
    );
  });
