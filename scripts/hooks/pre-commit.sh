#!/bin/sh
# Pre-commit, three fast checks on the staged files so a slip never costs a CI round trip:
# 1. refuses added lines citing a lead decision id or a git-ignored working path;
# 2. formats the staged files with biome and stages the result;
# 3. lints them with biome (ESLint stays in CI).
# A file that also has unstaged changes is not formatted or linted: formatting and staging it
# would commit those changes too. CI's format and lint checks stay the guarantee.

set -u

# Files that name the lead's working files on purpose (AGENTS.md "Files").
leaked_reference_check=$(git -c core.quotepath=false diff --cached -U0 --diff-filter=ACMR -- . \
  ':(exclude).claude/agents' ':(exclude)AGENTS.md' ':(exclude)docs/agents/orchestrator.md' \
  ':(exclude).gitignore' ':(exclude)eslint.config.js' ':(exclude)scripts/hooks/pre-commit.sh' |
  awk '/^\+\+\+ / { path = substr($0, 7); next }
       /^\+/ && /LD-[0-9]+|\.work\// { print path ": " substr($0, 2) }')

if [ -n "$leaked_reference_check" ]; then
  echo "pre-commit: commit refused, committed text must not cite LD-<n> or point into .work/:" >&2
  printf '%s\n' "$leaked_reference_check" >&2
  exit 1
fi

unstaged_files=$(git -c core.quotepath=false diff --name-only)

fully_staged_files=$(git -c core.quotepath=false diff --cached --name-only --diff-filter=ACMR | while IFS= read -r staged_file; do
  if printf '%s\n' "$unstaged_files" | grep -qxF -- "$staged_file"; then
    echo "pre-commit: $staged_file has unstaged changes, not formatted (CI checks the format)" >&2
    continue
  fi

  printf '%s\n' "$staged_file"
done)

if [ -z "$fully_staged_files" ]; then
  exit 0
fi

if ! pnpm exec biome --version >/dev/null 2>&1; then
  echo "pre-commit: biome is not installed in this checkout, files not formatted; run pnpm install --frozen-lockfile" >&2
  exit 0
fi

# Biome skips the files it does not handle (Markdown, YAML, PHP, Python, ignored paths).
if ! printf '%s\n' "$fully_staged_files" | tr '\n' '\0' |
  xargs -0 pnpm exec biome format --write --no-errors-on-unmatched --files-ignore-unknown=true; then
  echo "pre-commit: commit refused, biome could not format the files above; fix the syntax error it printed" >&2
  exit 1
fi

printf '%s\n' "$fully_staged_files" | tr '\n' '\0' | xargs -0 git add --

if ! printf '%s\n' "$fully_staged_files" | tr '\n' '\0' |
  xargs -0 pnpm exec biome lint --no-errors-on-unmatched --files-ignore-unknown=true; then
  echo "pre-commit: commit refused, fix the biome lint errors printed above" >&2
  exit 1
fi
