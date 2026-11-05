#!/usr/bin/env bash
# Prints the git range of the changes a run tests, from the event that started it, or nothing when the event has no
# base to compare with. Reads EVENT, PR_BASE (the pull request's base branch), PUSH_BEFORE (a push's old tip),
# MERGE_GROUP_BASE (a merge group's base commit) and HEAD_SHA (the commit the run tests) from the environment.
set -euo pipefail

: "${EVENT:?EVENT is unset: pass the event name of the run.}"

commit_exists() {
  [ -n "$1" ] && git cat-file -e "$1^{commit}" 2>/dev/null
}

# A schedule, a manual run, a new branch (all-zero sha) or a force push whose old tip the server no longer holds has
# no base: the caller runs every job.
case "$EVENT" in
  pull_request)
    echo "origin/${PR_BASE:?PR_BASE is unset: pass the base branch of the pull request.}...HEAD"
    ;;
  merge_group)
    # A merge group's base commit is an ancestor of the group's commit, so a full-history checkout holds it.
    if commit_exists "${MERGE_GROUP_BASE:-}"; then
      echo "$MERGE_GROUP_BASE..${HEAD_SHA:?HEAD_SHA is unset: pass the commit the run tests.}"
    fi
    ;;
  push)
    if commit_exists "${PUSH_BEFORE:-}"; then
      echo "$PUSH_BEFORE..${HEAD_SHA:?HEAD_SHA is unset: pass the commit the run tests.}"
    fi
    ;;
esac
