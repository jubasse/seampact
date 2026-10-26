#!/usr/bin/env bash
# Says which row classes a run holds, from the event that started it and the lane's run verdict. PR rows run on every
# run of the lane; post-merge rows on a push and on the drift events; drift rows (pre-releases, dependency drift,
# macOS) on the nightly schedule, a manual run and a release only. Prints `post-merge=<bool>` and `drift=<bool>`.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: row-classes.sh <event name> <lane run: true or false>" >&2
  exit 2
fi
event=$1
lane_run=$2

case "$lane_run" in
  true | false) ;;
  *)
    echo "The lane run verdict is '$lane_run', not true or false." >&2
    exit 1
    ;;
esac

case "$event" in
  pull_request)
    post_merge_rows=false
    drift_rows=false
    ;;
  push)
    post_merge_rows=true
    drift_rows=false
    ;;
  schedule | workflow_dispatch | release)
    post_merge_rows=true
    drift_rows=true
    ;;
  *)
    echo "No row class is defined for the '$event' event. Add it to row-classes.sh." >&2
    exit 1
    ;;
esac

# A lane with nothing to test runs no row of any class.
if [ "$lane_run" = false ]; then
  post_merge_rows=false
  drift_rows=false
fi

echo "post-merge=$post_merge_rows"
echo "drift=$drift_rows"
