import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// A local bare repository for the git channel: the bundle directory committed under `contract/` and tagged, then
// the tampered copy committed over it under a second tag.

export const SMOKE_GIT_TAG = "v1.0.0";
export const SMOKE_GIT_TAMPERED_TAG = "v1.0.0-tampered";
export const SMOKE_GIT_DIRECTORY = "contract";

export interface BundleRepository {
  /** The bare repository's `file:` URL. */
  readonly url: string;
  readonly bare: string;
}

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "seampact smoke",
  GIT_AUTHOR_EMAIL: "smoke@seampact.invalid",
  GIT_COMMITTER_NAME: "seampact smoke",
  GIT_COMMITTER_EMAIL: "smoke@seampact.invalid",
};

const GIT_SETTINGS = [
  "-c",
  "init.defaultBranch=main",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "tag.gpgsign=false",
  "-c",
  "core.autocrlf=false",
];

/** The bare repository under `work` holding both tags. */
export function createBundleRepository(
  work: string,
  bundleDirectory: string,
  tamperedDirectory: string,
): BundleRepository {
  const tree = join(work, "git-work");
  const bare = join(work, "contract.git");
  const git = (...args: string[]) =>
    execFileSync("git", [...GIT_SETTINGS, ...args], {
      cwd: tree,
      env: { ...process.env, ...GIT_IDENTITY },
      stdio: "pipe",
    });

  mkdirSync(tree, { recursive: true });
  git("init", "--quiet");
  commitTagged(git, tree, bundleDirectory, SMOKE_GIT_TAG);
  commitTagged(git, tree, tamperedDirectory, SMOKE_GIT_TAMPERED_TAG);
  execFileSync("git", [...GIT_SETTINGS, "clone", "--quiet", "--bare", "--", tree, bare], {
    stdio: "pipe",
  });

  return { url: pathToFileURL(bare).href, bare };
}

function commitTagged(
  git: (...args: string[]) => Buffer,
  tree: string,
  bundleDirectory: string,
  tag: string,
): void {
  cpSync(bundleDirectory, join(tree, SMOKE_GIT_DIRECTORY), { recursive: true });
  git("add", "--all");
  git("commit", "--quiet", "--message", `Bundle ${tag}.`);
  git("tag", tag);
}
