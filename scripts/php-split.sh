#!/usr/bin/env bash
# The split of the PHP packages into their mirror trees (ADR 0010 "PHP mirror repositories"): for each
# `php/<name>`, the directory's commits rewritten with it as the root, its tree under `<out-dir>/trees/<name>` with the
# repository's LICENSE added as the release commit adds it, and
# a `<name> <split commit>` line in `<out-dir>/splits.txt`. It pushes nothing; the release pushes the commits it lists.
# Run it in the repository; it needs the full history of the commit, which the split rewrites.
#   scripts/php-split.sh <out-dir> [<commit>]
set -euo pipefail

out="${1:?usage: scripts/php-split.sh <out-dir> [<commit>]}"
commit="${2:-HEAD}"

root="$(cd "$(git rev-parse --show-toplevel)" && pwd -P)"
out="$(mkdir -p "$out" && cd "$out" && pwd -P)"

# The out-dir is emptied first: one inside the repository could be part of the checkout.
case "$out/" in
  "$root"/*)
    echo "php-split: the out-dir $out is inside the repository $root; give one outside it (\$RUNNER_TEMP, a temp dir)." >&2
    exit 1
    ;;
esac

rm -rf "$out"
mkdir -p "$out/trees"
: > "$out/splits.txt"

cd "$root"

for manifest in php/*/composer.json; do
  name="$(basename "$(dirname "$manifest")")"
  split="$(git subtree split --quiet --prefix="php/$name" "$commit")"

  mkdir "$out/trees/$name"
  git archive "$split" | tar -x -C "$out/trees/$name"

  if [ ! -f "$out/trees/$name/composer.json" ]; then
    echo "php-split: the split tree of php/$name has no composer.json at its root." >&2
    exit 1
  fi

  # The mirror ships the repository's LICENSE, added by the release commit; the tree holds it as the mirror will.
  if ! git show "$commit:LICENSE" > "$out/trees/$name/LICENSE" 2> /dev/null; then
    echo "php-split: the commit $commit has no LICENSE at the repository root, which every mirror ships." >&2
    exit 1
  fi

  echo "$name $split" >> "$out/splits.txt"
done
