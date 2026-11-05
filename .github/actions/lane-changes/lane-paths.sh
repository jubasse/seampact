#!/usr/bin/env bash
# Prints the one extended regular expression a lane's changed paths are matched against: the pull-request paths on a
# pull request to develop when the lane gives them (the fast tier), the watched paths anywhere else. Reads EVENT,
# PR_BASE, WATCHED_PATHS and PULL_REQUEST_PATHS (one expression per line, the second optional) from the environment.
set -euo pipefail

: "${EVENT:?EVENT is unset: pass the event name of the run.}"

# The base branch whose pull requests run the fast tier.
fast_tier_base=develop

joined_pattern() {
  grep -v '^[[:space:]]*$' <<< "$1" | paste -sd '|' || true
}

watched_pattern=$(joined_pattern "${WATCHED_PATHS:-}")
if [ -z "$watched_pattern" ]; then
  echo "watched-paths is empty, so the lane would never run. List the paths its tests read." >&2
  exit 1
fi

pull_request_pattern=$(joined_pattern "${PULL_REQUEST_PATHS:-}")
if [ "$EVENT" = pull_request ] && [ "${PR_BASE:-}" = "$fast_tier_base" ] && [ -n "$pull_request_pattern" ]; then
  echo "$pull_request_pattern"
else
  echo "$watched_pattern"
fi
