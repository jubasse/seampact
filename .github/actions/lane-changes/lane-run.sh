#!/usr/bin/env bash
# Decides whether a lane runs. Reads the changed paths NUL-separated on stdin, takes the lane's watched paths as one
# extended regular expression, and prints true or false.
set -euo pipefail

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "usage: lane-run.sh <watched-paths-regex> < NUL-separated changed paths" >&2
  exit 2
fi
watched_pattern=$1

# Documentation no lane test reads: Markdown outside the packages and fixtures, and anything under docs/ but the
# grammar, the IR and the conformance checklist. The `ci` workflow, which always runs, also reads docs/adr/.
documentation_pattern='^docs/|\.md$'
read_by_tests_pattern='^(packages|fixtures|docs/grammar|docs/ir|docs/conformance)/'

changed_count=0
code_change_count=0
watched_change_count=0
# The last path counts even without a trailing NUL.
while IFS= read -r -d '' changed_path || [ -n "$changed_path" ]; do
  changed_count=$((changed_count + 1))

  if ! [[ "$changed_path" =~ $documentation_pattern ]] || [[ "$changed_path" =~ $read_by_tests_pattern ]]; then
    code_change_count=$((code_change_count + 1))
  fi

  if [[ "$changed_path" =~ $watched_pattern ]]; then
    watched_change_count=$((watched_change_count + 1))
  fi
done

# An empty diff runs every job rather than none.
if [ "$changed_count" -eq 0 ]; then
  echo true
elif [ "$code_change_count" -eq 0 ]; then
  echo false
elif [ "$watched_change_count" -gt 0 ]; then
  echo true
else
  echo false
fi
