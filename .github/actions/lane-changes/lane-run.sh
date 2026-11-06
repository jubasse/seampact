#!/usr/bin/env bash
# Decides whether a lane runs. Reads the changed paths NUL-separated on stdin, takes the lane's watched paths as one
# extended regular expression, and prints true or false.
set -euo pipefail

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "usage: lane-run.sh <watched-paths-regex> < NUL-separated changed paths" >&2
  exit 2
fi
watched_pattern=$1

# Documentation no lane test reads, and package tests: Markdown outside the packages and fixtures, anything under docs/ but the
# grammar, the IR and the conformance checklist, and the docs site package, which only its own lane builds. The `ci`
# workflow, which always runs, also reads docs/adr/.
documentation_pattern='^docs/|\.md$'
read_by_tests_pattern='^(packages|fixtures|docs/grammar|docs/ir|docs/conformance)/'
docs_site_pattern='^packages/tools/docs-site/'
# Package tests and their support files: only the `ci` workflow, which always runs, runs them; no package build
# includes them.
package_test_pattern='^packages/.*(\.test\.ts|\.test-support\.ts|/test-support\.ts)$'
# Package tests a lane runs itself: the hooks tests (p4-hooks-native) and the reference tarball writer (p3-dist).
lane_test_pattern='^packages/runtime/hooks/|^packages/core/compiler/src/bundle/reference-tarball\.test-support\.ts$'

is_documentation() {
  [[ "$1" =~ $docs_site_pattern ]] && return 0
  [[ "$1" =~ $package_test_pattern ]] && ! [[ "$1" =~ $lane_test_pattern ]] && return 0

  [[ "$1" =~ $documentation_pattern ]] && ! [[ "$1" =~ $read_by_tests_pattern ]]
}

changed_count=0
code_change_count=0
watched_change_count=0
# The last path counts even without a trailing NUL.
while IFS= read -r -d '' changed_path || [ -n "$changed_path" ]; do
  changed_count=$((changed_count + 1))

  if ! is_documentation "$changed_path"; then
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
