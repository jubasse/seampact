#!/usr/bin/env bash
# Prints the number of the pull request a merge group tests, from the group's branch,
# `gh-readonly-queue/<base>/pr-<number>-<head sha>`: the last pull request of the group, which a failure ejects.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: queue-pull-request.sh <merge group branch>" >&2
  exit 2
fi
group_branch=$1

queue_branch_pattern='^gh-readonly-queue/[^/]+(/[^/]+)*/pr-([0-9]+)-[0-9a-f]{40}$'
if ! [[ "$group_branch" =~ $queue_branch_pattern ]]; then
  echo "The merge group branch '$group_branch' is not gh-readonly-queue/<base>/pr-<number>-<sha>: GitHub changed" >&2
  echo "its queue branch names; update queue-pull-request.sh." >&2
  exit 1
fi

echo "${BASH_REMATCH[2]}"
