#!/bin/sh
# Assembles the Django Ninja consumer in <work>: `assemble.sh <work> <bundled> [allow-listed|pack-laravel]`, as the
# shared Python `assemble.sh` does for this directory, with the views SEAMPACT_NINJA_VIEWS names (`sync` or `async`) in
# every entry's options. The app takes the FastAPI consumer's handlers and sample data, which read the same Pydantic
# operations, the DRF consumer's Django control views and paging factories, and the shared reference hook and paging
# doubles.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
consumers="$here/../.."
views="${SEAMPACT_NINJA_VIEWS:-}"

case "$views" in
  sync | async) ;;
  *) echo "assemble.sh: set SEAMPACT_NINJA_VIEWS to sync or async, not '$views'." >&2; exit 1 ;;
esac

"$consumers/python/assemble.sh" "$here" "$@"

case "${3:-}" in
  "") app="$1/app" ;;
  *) app="$1/app-$3" ;;
esac

cp "$consumers/targets/fastapi/app/handlers.py" "$consumers/targets/fastapi/app/sample_data.py" "$app/"
# The hook-check-off app's generated code has no `health` types, so it goes without the `health` handlers.
if [ "${3:-}" = "hook-check-off" ]; then
  rm "$app/health_handler_factories.py"
else
  cp "$consumers/targets/fastapi/app/health_handlers.py" "$app/"
fi
cp "$consumers/targets/drf/app/control.py" "$consumers/targets/drf/app/paging_factories.py" "$app/"
cp "$consumers/python/reference_doubles/hook_doubles.py" "$consumers/python/reference_doubles/paging_doubles.py" "$app/"
sed -i "s/views: sync/views: $views/" "$app/seampact.config.yaml"
