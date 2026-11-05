#!/usr/bin/env bash
# Downloads the http-suite reports the consumer workflows uploaded on develop into <dir>, one directory per artefact:
# for each artefact name, the newest unexpired copy from a develop run of this repository that succeeded on a push or
# a schedule (never a fork's or a pull request's run). A consumer workflow skips its suite when a push does not touch
# it, so the newest copy of each name may come from an older run than the others: each line printed names the run and
# its commit. With SUITE_REPORTS_COMMIT set (the gate after the nightly), only the runs of that commit count.
# Needs `gh` signed in (GH_TOKEN in CI) and the repository as the current directory or GH_REPO.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: fetch-suite-reports.sh <dir>" >&2
  exit 2
fi

target_dir="$1"
branch="${SUITE_REPORTS_BRANCH:-develop}"
commit="${SUITE_REPORTS_COMMIT:-}"
mkdir -p "$target_dir"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# One line per artefact: name, run id, creation time; newest first, so the first line of each name wins.
gh api --paginate 'repos/{owner}/{repo}/actions/artifacts?per_page=100' |
  jq -r --arg branch "$branch" -f "$script_dir/suite-artefacts.jq" |
  sort -k1,1 -k3,3r >"$target_dir/.artefacts"

# Per run id: the commit of a trusted run (suite-run.jq), empty for a run that does not count.
declare -A run_commit=()
declare -A chosen=()

while read -r name run_id _created_at; do
  [[ -n "${chosen[$name]:-}" ]] && continue

  if [[ -z "${run_commit[$run_id]+set}" ]]; then
    run_commit[$run_id]="$(gh api "repos/{owner}/{repo}/actions/runs/$run_id" |
      jq -r --arg branch "$branch" --arg commit "$commit" -f "$script_dir/suite-run.jq")"
  fi

  [[ -n "${run_commit[$run_id]}" ]] || continue
  chosen[$name]="$run_id"
done <"$target_dir/.artefacts"

rm "$target_dir/.artefacts"

if [[ ${#chosen[@]} -eq 0 ]]; then
  echo "fetch-suite-reports: no http-suite artefact from a successful $branch run" >&2
  exit 1
fi

for name in $(printf '%s\n' "${!chosen[@]}" | sort); do
  echo "fetch-suite-reports: $name from run ${chosen[$name]} at ${run_commit[${chosen[$name]}]}"
  gh run download "${chosen[$name]}" --name "$name" --dir "$target_dir/$name"
done
