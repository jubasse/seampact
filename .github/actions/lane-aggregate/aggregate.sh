#!/usr/bin/env bash
# The verdict of a lane's required check. Reads the aggregate job's `needs` context as JSON in NEEDS_JSON, the lane's
# change filter verdict in SHOULD_RUN, and in ALLOW_SKIP the needed jobs whose skip is expected on this run.
# A job whose id ends in `-post-merge` or `-drift` holds the rows of that class: its skip is expected when the
# `changes` job's output of the same name says the run holds no row of that class.
set -euo pipefail

results=$(jq -r 'to_entries[] | "\(.key)=\(.value.result)"' <<< "$NEEDS_JSON")
echo "Needed jobs: $(tr '\n' ' ' <<< "$results")"
if [ -z "$results" ]; then
  echo "The aggregate needs no job, so it would pass with nothing tested. List the lane's jobs under needs."
  exit 1
fi

failed=$(grep -E '=(failure|cancelled)$' <<< "$results" || true)
if [ -n "$failed" ]; then
  echo "A needed job failed or was cancelled: $(tr '\n' ' ' <<< "$failed")"
  exit 1
fi

case "$SHOULD_RUN" in
  true | false) ;;
  *)
    echo "should-run is '$SHOULD_RUN', not true or false: the change filter gave no answer. Fix its output."
    exit 1
    ;;
esac

read -r -a allowed_skips <<< "$(tr '\n' ' ' <<< "${ALLOW_SKIP:-}")"
for allowed_job in "${allowed_skips[@]}"; do
  if ! jq -e --arg job "$allowed_job" 'has($job)' <<< "$NEEDS_JSON" > /dev/null; then
    echo "allow-skip names '$allowed_job', which the aggregate does not need. Fix the name or add it to needs."
    exit 1
  fi
done

# The changes job's verdict for a row class: true, false, or `absent` when the job gives no such output.
class_rows() {
  jq -r --arg class "$1" '.changes.outputs[$class] // "absent"' <<< "$NEEDS_JSON"
}

is_skip_expected() {
  local job=$1
  local allowed_job
  for allowed_job in "${allowed_skips[@]}"; do
    if [ "$job" = "$allowed_job" ]; then return 0; fi
  done

  local class
  case "$job" in
    *-post-merge) class=post-merge ;;
    *-drift) class=drift ;;
    *) return 1 ;;
  esac

  local rows
  rows=$(class_rows "$class")
  case "$rows" in
    false) return 0 ;;
    true) return 1 ;;
    *)
      echo "The job '$job' holds $class rows, but the changes job gives no '$class' output ('$rows')." >&2
      echo "Expose the lane-changes '$class' output on the changes job." >&2
      exit 1
      ;;
  esac
}

if [ "$SHOULD_RUN" = true ]; then
  unexpected_skips=()
  for job in $(grep -E '=skipped$' <<< "$results" | cut -d = -f 1 || true); do
    if ! is_skip_expected "$job"; then unexpected_skips+=("$job"); fi
  done

  if [ "${#unexpected_skips[@]}" -gt 0 ]; then
    echo "The change filter said run, but these jobs were skipped: ${unexpected_skips[*]}"
    echo "A wiring slip (a wrong if: or needs:) would otherwise pass with nothing tested."
    exit 1
  fi
fi

unknown=$(grep -vE '=(success|skipped)$' <<< "$results" || true)
if [ -n "$unknown" ]; then
  echo "A needed job ended with an unknown result: $(tr '\n' ' ' <<< "$unknown")"
  exit 1
fi
