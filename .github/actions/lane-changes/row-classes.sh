#!/usr/bin/env bash
# Says which row classes a run holds, from the event that started it, the lane's run verdict and, on a pull request,
# its base branch. PR rows run on every run of the lane; queue rows (the rest of the full tier) on a push, a merge
# group, a pull request to main and the drift events, but not on a pull request to develop (the fast tier); post-merge
# rows on a push and on the drift events; drift rows (pre-releases, dependency drift, macOS) on the nightly schedule,
# a manual run and a release only. Prints `queue`, `post-merge` and `drift`, each `=<bool>`.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: row-classes.sh <event name> <lane run: true or false> <pull request base branch, or empty>" >&2
  exit 2
fi
event=$1
lane_run=$2
pull_request_base=$3

case "$lane_run" in
  true | false) ;;
  *)
    echo "The lane run verdict is '$lane_run', not true or false." >&2
    exit 1
    ;;
esac

# The fast tier: a pull request to develop runs its PR rows only, and the push after its merge runs the rest.
fast_tier_base=develop

case "$event" in
  pull_request)
    if [ -z "$pull_request_base" ]; then
      echo "The pull request's base branch is empty: pass github.base_ref, which decides whether queue rows run." >&2
      exit 1
    fi
    queue_rows=$([ "$pull_request_base" = "$fast_tier_base" ] && echo false || echo true)
    post_merge_rows=false
    drift_rows=false
    ;;
  merge_group)
    queue_rows=true
    post_merge_rows=false
    drift_rows=false
    ;;
  push)
    queue_rows=true
    post_merge_rows=true
    drift_rows=false
    ;;
  schedule | workflow_dispatch | release)
    queue_rows=true
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
  queue_rows=false
  post_merge_rows=false
  drift_rows=false
fi

echo "queue=$queue_rows"
echo "post-merge=$post_merge_rows"
echo "drift=$drift_rows"
