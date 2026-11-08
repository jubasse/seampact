#!/bin/sh
# Pre-commit: formats the staged files with biome and stages the result, so a format slip never
# costs a CI round trip. A file that also has unstaged changes is skipped: formatting and staging
# it would commit those changes too. CI's format check stays the guarantee.

set -u

unstaged_files=$(git diff --name-only)

fully_staged_files=$(git diff --cached --name-only --diff-filter=ACMR | while IFS= read -r staged_file; do
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
