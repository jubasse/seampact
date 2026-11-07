#!/usr/bin/env bash
# Downloads the http-suite reports the consumer workflows uploaded on develop into <dir>, one directory per artefact:
# for each artefact name, the newest unexpired copy from a develop run of this repository that succeeded on a push or
# a schedule (never a fork's or a pull request's run). A consumer workflow skips its suite when a push does not touch
# it, so the newest copy of each name may come from an older run than the others: each line printed names the run and
# its commit. It also writes ci-jobs.json, the newest develop result of each CI job a proof file cites. With
# SUITE_REPORTS_COMMIT set, only the runs of that commit count. The release gate also sets SUITE_REPORTS_RUNS, the
# space-separated ids of the runs the release started at its commit, and SUITE_REPORTS_BRANCH, the release's branch:
# then only those runs count.
# Needs `gh` signed in (GH_TOKEN in CI) and the repository as the current directory or GH_REPO.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: fetch-suite-reports.sh <dir>" >&2
  exit 2
fi

target_dir="$1"
branch="${SUITE_REPORTS_BRANCH:-develop}"
commit="${SUITE_REPORTS_COMMIT:-}"
runs="${SUITE_REPORTS_RUNS:-}"

if [[ -n "$runs" && ! "$runs" =~ ^[0-9]+( [0-9]+)*$ ]]; then
  echo "fetch-suite-reports: SUITE_REPORTS_RUNS must be run ids separated by single spaces, not '$runs'" >&2
  exit 2
fi

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
      jq -r --arg branch "$branch" --arg commit "$commit" --arg runs "$runs" -f "$script_dir/suite-run.jq")"
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

# The CI jobs the proof files cite (`ci:` references): for each, the conclusion of the newest run on $branch in which
# the job ran, written to ci-jobs.json beside the reports. A job without such a run gets no result, and the gate names
# it. The newest runs only: a job that last ran more than RUNS_PER_WORKFLOW runs ago counts as unrecorded.
runs_per_workflow=30
repo_root="$(cd "$script_dir/../.." && pwd)"
ci_results=()

while IFS=$'\t' read -r workflow job name mode; do
  result=""

  while read -r run_id head_sha; do
    conclusion="$(gh api --paginate "repos/{owner}/{repo}/actions/runs/$run_id/jobs?per_page=100" |
      jq -s '{jobs: (map(.jobs) | add)}' |
      jq -r --arg name "$name" --arg mode "$mode" -f "$script_dir/ci-job.jq")"

    if [[ -n "$conclusion" ]]; then
      result="$(jq -n --arg ref "$workflow#$job" --arg conclusion "$conclusion" --argjson run "$run_id" \
        --arg commit "$head_sha" '{ref: $ref, conclusion: $conclusion, run: $run, commit: $commit}')"
      break
    fi
  done < <(gh api "repos/{owner}/{repo}/actions/workflows/$workflow/runs?branch=$branch&per_page=$runs_per_workflow" |
    jq -r --arg branch "$branch" --arg commit "$commit" --arg runs "$runs" -f "$script_dir/ci-runs.jq")

  if [[ -n "$result" ]]; then
    echo "fetch-suite-reports: CI job $workflow#$job $(jq -r '"\(.conclusion) in run \(.run) at \(.commit)"' <<<"$result")"
    ci_results+=("$result")
  else
    echo "fetch-suite-reports: CI job $workflow#$job has no recent $branch run" >&2
  fi
done < <(node "$script_dir/cli.ts" ci-jobs --root "$repo_root")

printf '%s\n' "${ci_results[@]}" | jq -s '{format: "seampact-ci-jobs/1", jobs: map(select(. != null))}' \
  >"$target_dir/ci-jobs.json"
