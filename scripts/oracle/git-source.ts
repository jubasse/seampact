import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The bare repository of a CLI case's `git-source/<tag>/` directories: one commit per directory in name order, whose
// tree is that directory alone, tagged with the directory's name. The author and dates are fixed, so the same case
// gives the same repository on every machine.

export const GIT_SOURCE_DIRECTORY = "git-source";
export const GIT_SOURCE_REPOSITORY = "git-source.git";

const GIT_ENVIRONMENT = {
  GIT_AUTHOR_NAME: "oracle",
  GIT_AUTHOR_EMAIL: "oracle@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_NAME: "oracle",
  GIT_COMMITTER_EMAIL: "oracle@example.invalid",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};
const MAIN_BRANCH = "main";

function git(directory: string, args: readonly string[]): void {
  execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd: directory,
    env: { ...process.env, ...GIT_ENVIRONMENT },
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function emptyWorkTree(directory: string): void {
  for (const name of readdirSync(directory))
    if (name !== ".git") rmSync(join(directory, name), { recursive: true, force: true });
}

/** Builds `<root>/git-source.git` from the tag directories under `source`. */
export function buildGitSource(source: string, root: string): void {
  const repository = join(root, GIT_SOURCE_REPOSITORY);
  const work = mkdtempSync(join(realpathSync(tmpdir()), "seampact-oracle-git-"));

  try {
    git(root, ["init", "--bare", "-q", "-b", MAIN_BRANCH, repository]);
    git(work, ["init", "-q", "-b", MAIN_BRANCH]);

    for (const tag of readdirSync(source).sort()) {
      emptyWorkTree(work);
      cpSync(join(source, tag), work, { recursive: true, verbatimSymlinks: true });
      git(work, ["add", "-A", "-f"]);
      git(work, ["commit", "-q", "--allow-empty", "-m", tag]);
      git(work, ["tag", tag]);
    }

    git(work, ["push", "-q", repository, `HEAD:refs/heads/${MAIN_BRANCH}`, "--tags"]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
