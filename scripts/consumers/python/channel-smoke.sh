#!/bin/bash
# The Python leg of the channel smoke tests (ADR 0011 "Channel smoke tests"): `channel-smoke.sh <work> <venv> <served>
# <distribution>` makes a project in <work> that uses <distribution> (installed in <venv>) with `openapi: none` and no
# binary, and runs `seampact generate` and `seampact check` from the release and git channels that
# `scripts/dist-smoke/cli.ts serve` started (<served> holds its JSON line). A genuine copy must pass; each tampered
# copy must be refused as `bundle.file-hash`, naming the tampered file. The bundle cache is emptied before each case,
# since it is keyed by integrity, which the tampered copy shares. <work> is new.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
. "$here/absolute-path.sh"

work=$(absolute_path "$1")
venv=$(absolute_path "$2")
served=$(absolute_path "$3")
distribution="$4"
app="$work/app"

if [ -e "$work" ]; then
  echo "channel-smoke.sh: $work exists; give a new directory." >&2
  exit 1
fi

integrity=$(jq -r .integrity "$served")
tampered_file=$(jq -r .tamperedFile "$served")
mkdir -p "$app" "$work/cache"
chmod 700 "$work/cache"

# The run is private to its cache and trusts the release channel's certificate authority only.
export XDG_CACHE_HOME="$work/cache"
export SSL_CERT_FILE
SSL_CERT_FILE=$(jq -r .release.caFile "$served")

# `pass` expects a generated and checked app, `tampered` the refusal naming the tampered file. The local git channel
# is a file URL, which `allowLocal` accepts.
run_case() {
  local name="$1" source_lines="$2" expected="$3" outcome
  rm -rf "$app/generated" "$work/cache/seampact/bundles"
  printf 'outDir: generated\nopenapi: none\nallowLocal: true\nsources:\n%s\ntargets:\n  - { id: tasks, out: tasks, use: "pypi:%s", api: tasks, operations: { include: [health, getTask] } }\n' \
    "$source_lines" "$distribution" > "$app/seampact.config.yaml"

  if (cd "$app" && "$venv/bin/seampact" generate && "$venv/bin/seampact" check) > "$work/$name.log" 2>&1; then
    outcome=pass
  else
    outcome=refused
  fi

  if [ "$expected" = pass ] && [ "$outcome" = pass ]; then
    echo "python $name: generated and checked from the bundle."
  elif [ "$expected" = tampered ] && [ "$outcome" = refused ] && grep -q 'bundle.file-hash' "$work/$name.log" \
    && grep -qF "$tampered_file" "$work/$name.log"; then
    echo "python $name: the tampered copy is refused as bundle.file-hash, naming $tampered_file."
  else
    echo "python $name: expected $expected, the run ended $outcome; its log:" >&2
    cat "$work/$name.log" >&2
    exit 1
  fi
}

release_source() { printf '  contract:\n    release: { url: "%s" }\n    integrity: "%s"' "$1" "$integrity"; }
git_source() {
  printf '  contract:\n    git: { url: "%s", tag: "%s", directory: "%s" }\n    integrity: "%s"' \
    "$(jq -r .git.url "$served")" "$1" "$(jq -r .git.directory "$served")" "$integrity"
}

run_case release "$(release_source "$(jq -r .release.url "$served")")" pass
run_case release-tampered "$(release_source "$(jq -r .release.tamperedUrl "$served")")" tampered
run_case git "$(git_source "$(jq -r .git.tag "$served")")" pass
run_case git-tampered "$(git_source "$(jq -r .git.tamperedTag "$served")")" tampered
