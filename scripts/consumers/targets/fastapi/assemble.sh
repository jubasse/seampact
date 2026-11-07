#!/bin/sh
# Assembles the FastAPI consumer in <work>: `assemble.sh <work> <bundled>
# [allow-listed|route-check-off|hook-check-off|pack-laravel]`, as the shared Python `assemble.sh` does for this
# directory, with the shared reference hook doubles; the `hook-check-off` app, whose generated code has no `health`
# types, without the `health` handlers.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
"$here/../../python/assemble.sh" "$here" "$@"

case "${3:-}" in
  "") app="$1/app" ;;
  *) app="$1/app-$3" ;;
esac


if [ "${3:-}" = "hook-check-off" ]; then
  rm "$app/health_handlers.py"
fi
cp "$here/../../python/reference_doubles/hook_doubles.py" "$here/../../python/reference_doubles/paging_doubles.py" "$app/"
