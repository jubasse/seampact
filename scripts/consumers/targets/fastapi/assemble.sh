#!/bin/sh
# Assembles the FastAPI consumer in <work>: `assemble.sh <work> <bundled> [allow-listed]`, as the shared Python
# `assemble.sh` does for this directory, with the shared reference hook doubles.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
"$here/../../python/assemble.sh" "$here" "$@"

case "${3:-}" in
  "") app="$1/app" ;;
  *) app="$1/app-$3" ;;
esac

cp "$here/../../python/reference_doubles/hook_doubles.py" "$app/"
