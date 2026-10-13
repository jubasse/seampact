#!/bin/sh
# Pre-push check that docs/agents/cartography.md is current. It checks the current checkout,
# not the pushed commits, so it skips when a pushed commit is not HEAD or the tree has
# uncommitted changes. The CI check (p1-repo-checks.yml) is the guarantee.
#
# Git passes one line per pushed ref on stdin: <local ref> <local sha> <remote ref> <remote sha>.

set -u

checked_out_sha=$(git rev-parse HEAD)

while read -r local_ref local_sha _remote_ref_and_sha; do
  # A deleted remote ref is pushed as an all-zero local sha: nothing to check for it.
  case "$local_sha" in
    *[!0]*) ;;
    *) continue ;;
  esac

  if [ "$local_sha" != "$checked_out_sha" ]; then
    echo "pre-push: $local_ref is not the checked-out commit, map not checked (CI checks it)"
    exit 0
  fi
done

if [ -n "$(git status --porcelain)" ]; then
  echo "pre-push: the working tree has uncommitted changes, map not checked (CI checks it)"
  exit 0
fi

if ! node scripts/cartography/cli.ts --check; then
  echo "pre-push: push refused, fix the cartography problem printed above, commit, then push again" >&2
  exit 1
fi
