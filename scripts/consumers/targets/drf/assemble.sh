#!/bin/sh
# Assembles the DRF consumer in <work>: `assemble.sh <work> <bundled> [allow-listed]`, as the shared Python
# `assemble.sh` does for this directory.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
exec "$here/../../python/assemble.sh" "$here" "$@"
