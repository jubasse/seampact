#!/usr/bin/env bash
# Starts every workflow of <workflow-list> on <ref> and waits until every run completes. The list is the output of
# `node scripts/checklist/cli.ts gate-workflows`, made by an earlier job that holds no token: one workflow file
# per line, followed, tab-separated, by `release-gate` when the workflow takes that input (it skips the drift rows).
# Each run id is appended to <runs-file> as soon as the run starts, so the gate reads those runs only. Prints one
# line per run; fails when a run is at another commit than <commit> (the branch moved), did not succeed, or still runs
# after the deadline. A run that failed on a registry error (registry-failure.sh reads its failed jobs' log) has its
# failed jobs rerun once, and the wait reads that new attempt; any other failure, or a second one, fails as it is. A
# failed read of a run's state is retried after a doubling pause; the wait fails only when every attempt failed. Runs
# `gh` alone: it needs `gh` signed in with `actions: write` (GH_TOKEN in CI) and the repository
# as the current directory or GH_REPO.
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: run-gate-workflows.sh <ref> <commit> <workflow-list> <runs-file>" >&2
  exit 2
fi

ref="$1"
commit="$2"
workflow_list_file="$3"
runs_file="$4"
poll_seconds=60
# Under the calling job's timeout by more than one read's retries, so the runs still going are named before the job
# is killed; it leaves time for a run whose failed jobs are rerun once.
deadline_seconds=$((230 * 60))
# A run's state is read up to this many times, the pause doubling after each failed read.
state_read_attempts=5
first_retry_pause_seconds=10
# The API version whose workflow dispatch answers with the run it created.
dispatch_api_version="2026-03-10"
registry_failure="$(dirname "${BASH_SOURCE[0]}")/registry-failure.sh"

# The status, conclusion, commit and attempt number of a run, on one line; a failed read is retried, and only the last failure fails.
run_state_of() {
  local run_id=$1
  local pause=$first_retry_pause_seconds
  local attempt state

  for ((attempt = 1; attempt <= state_read_attempts; attempt++)); do
    if state="$(gh api "repos/{owner}/{repo}/actions/runs/$run_id" \
      --jq '"\(.status) \(.conclusion // "none") \(.head_sha) \(.run_attempt)"')"; then
      printf '%s\n' "$state"
      return 0
    fi

    if ((attempt < state_read_attempts)); then
      echo "run-gate-workflows: reading run $run_id failed (attempt $attempt of $state_read_attempts), retrying in ${pause}s" >&2
      sleep "$pause"
      pause=$((pause * 2))
    fi
  done

  echo "run-gate-workflows: reading run $run_id failed $state_read_attempts times: check the GitHub status, then start the release again" >&2
  return 1
}

# Reruns the failed jobs of a failed run when their log names a registry error; fails, saying why, otherwise.
rerun_on_registry_failure() {
  local workflow=$1 run_id=$2
  local failed_log matched_line

  if ! failed_log="$(gh run view "$run_id" --log-failed)"; then
    echo "run-gate-workflows: the failed jobs' log of $workflow run $run_id could not be read, so it is not rerun" >&2
    return 1
  fi

  if ! matched_line="$(printf '%s\n' "$failed_log" | bash "$registry_failure")"; then
    return 1
  fi

  echo "run-gate-workflows: $workflow run $run_id failed on a registry error, its failed jobs run once more: $matched_line"

  if ! gh run rerun "$run_id" --failed; then
    echo "run-gate-workflows: rerunning the failed jobs of $workflow run $run_id failed" >&2
    return 1
  fi
}

if [[ ! -s "$workflow_list_file" ]]; then
  echo "run-gate-workflows: $workflow_list_file names no workflow for the release gate" >&2
  exit 1
fi

: >"$runs_file"
declare -A run_of=()
# Per workflow, the attempt whose failed jobs were rerun: a run is rerun once, and read again once a new attempt starts.
declare -A rerun_attempt_of=()
workflows=()

while IFS=$'\t' read -r workflow release_gate_input; do
  # The list comes from a job that ran third-party code: only a workflow file name and the one known input pass.
  if [[ ! "$workflow" =~ ^[A-Za-z0-9._-]+\.ya?ml$ || ! "$release_gate_input" =~ ^(release-gate)?$ ]]; then
    echo "run-gate-workflows: not a workflow line of gate-workflows: '$workflow' '$release_gate_input'" >&2
    exit 1
  fi

  dispatch_fields=(-f ref="$ref")
  if [[ -n "$release_gate_input" ]]; then
    dispatch_fields+=(-f "inputs[$release_gate_input]=true")
  fi

  run_id="$(gh api --method POST -H "X-GitHub-Api-Version: $dispatch_api_version" \
    "repos/{owner}/{repo}/actions/workflows/$workflow/dispatches" "${dispatch_fields[@]}" --jq '.workflow_run_id')"

  if [[ ! "$run_id" =~ ^[0-9]+$ ]]; then
    echo "run-gate-workflows: starting $workflow on $ref returned no run id" >&2
    exit 1
  fi

  run_of[$workflow]="$run_id"
  workflows+=("$workflow")
  echo "$run_id" >>"$runs_file"
  echo "run-gate-workflows: $workflow started on $ref as run $run_id${release_gate_input:+ ($release_gate_input set)}"
done <"$workflow_list_file"

pending=("${workflows[@]}")
failed=0

while true; do
  still_running=()

  for ((index = 0; index < ${#pending[@]}; index++)); do
    workflow="${pending[index]}"
    run_id="${run_of[$workflow]}"

    if ((SECONDS > deadline_seconds)); then
      echo "run-gate-workflows: still running after $((deadline_seconds / 60)) minutes: ${still_running[*]} ${pending[*]:index}" >&2
      exit 1
    fi

    run_state="$(run_state_of "$run_id")"
    read -r status conclusion head_sha attempt <<<"$run_state"

    if [[ "$head_sha" != "$commit" ]]; then
      echo "run-gate-workflows: $workflow run $run_id is at $head_sha, not $commit: $ref moved, start the release again" >&2
      failed=1
    elif [[ "$status" != completed || "$attempt" == "${rerun_attempt_of[$workflow]:-}" ]]; then
      still_running+=("$workflow")
    elif [[ "$conclusion" != success && -z "${rerun_attempt_of[$workflow]:-}" ]] &&
      rerun_on_registry_failure "$workflow" "$run_id"; then
      rerun_attempt_of[$workflow]="$attempt"
      still_running+=("$workflow")
    else
      echo "run-gate-workflows: $workflow run $run_id at $commit concluded $conclusion"
      [[ "$conclusion" == success ]] || failed=1
    fi
  done

  [[ ${#still_running[@]} -eq 0 ]] && break

  pending=("${still_running[@]}")
  sleep "$poll_seconds"
done

exit "$failed"
