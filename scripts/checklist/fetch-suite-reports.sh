#!/usr/bin/env bash
# Downloads the http-suite reports the consumer workflows uploaded on develop into <dir>, one directory per artefact:
# for each artefact name, the newest unexpired copy from a develop run that succeeded. A consumer workflow skips its
# suite when a push does not touch it, so the newest copy of each name may come from an older run than the others.
# Needs `gh` signed in (GH_TOKEN in CI) and the repository as the current directory or GH_REPO.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: fetch-suite-reports.sh <dir>" >&2
  exit 2
fi

target_dir="$1"
branch="${SUITE_REPORTS_BRANCH:-develop}"
mkdir -p "$target_dir"

# One line per artefact: name, run id, creation time; newest first, so the first line of each name wins.
gh api --paginate 'repos/{owner}/{repo}/actions/artifacts?per_page=100' \
  --jq ".artifacts[]
    | select(.expired | not)
    | select(.name | test(\"-http-suite-\"))
    | select(.workflow_run.head_branch == \"$branch\")
    | \"\(.name) \(.workflow_run.id) \(.created_at)\"" |
  sort -k1,1 -k3,3r >"$target_dir/.artefacts"

declare -A run_conclusion=()
declare -A chosen=()

while read -r name run_id _created_at; do
  [[ -n "${chosen[$name]:-}" ]] && continue

  if [[ -z "${run_conclusion[$run_id]:-}" ]]; then
    run_conclusion[$run_id]="$(gh api "repos/{owner}/{repo}/actions/runs/$run_id" --jq '.conclusion // "pending"')"
  fi

  [[ "${run_conclusion[$run_id]}" == "success" ]] || continue
  chosen[$name]="$run_id"
done <"$target_dir/.artefacts"

rm "$target_dir/.artefacts"

if [[ ${#chosen[@]} -eq 0 ]]; then
  echo "fetch-suite-reports: no http-suite artefact from a successful $branch run" >&2
  exit 1
fi

for name in $(printf '%s\n' "${!chosen[@]}" | sort); do
  echo "fetch-suite-reports: $name from run ${chosen[$name]}"
  gh run download "${chosen[$name]}" --name "$name" --dir "$target_dir/$name"
done
