import { execFileSync } from "node:child_process";

/**
 * When a repository file last changed, from its git history; undefined for a file git has no
 * commit for. The pages are written to a git-ignored folder, so Starlight cannot read their
 * history itself. A shallow checkout dates every file at its tip: CI checks out the full history.
 */
export function lastCommitDate(repositoryRoot: string, repositoryPath: string): Date | undefined {
  const output = execFileSync("git", ["log", "-1", "--format=%cI", "--", repositoryPath], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();

  return output === "" ? undefined : new Date(output);
}
