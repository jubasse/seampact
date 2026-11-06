#!/usr/bin/env bash
# The FastAPI consumer of the registry proof: a new virtual environment with the third-party requirements of the
# workspace lock pinned by hash, then seampact-fastapi[generate], seampact-signed-webhooks and seampact-ir[compiler]
# at the release version from <local-index> first (the rehearsal's simple index) and PyPI after it, or from PyPI
# alone; then the consumer of scripts/consumers/targets/fastapi assembled and generated, its OpenAPI document written
# by the compiler of the seampact-compiler wheel. The suite serves <work>/app from <work>/venv.
#   scripts/release/registry-proof/fastapi.sh <bundled> <version> <work> [<local-index-url>]
set -euo pipefail

if [ $# -lt 3 ] || [ $# -gt 4 ]; then
  echo "usage: $0 <bundled> <version> <work> [<local-index-url>]" >&2
  exit 2
fi

bundled="$1"
version="$2"
work="$3"
local_index="${4:-}"
here="$(cd "$(dirname "$0")" && pwd)"
consumers="$(cd "$here/../../consumers" && pwd)"
pypi="https://pypi.org/simple"

if [ -e "$work" ]; then
  echo "fastapi: $work exists; give a new work directory." >&2
  exit 1
fi

mkdir -p "$work"
sh "$consumers/python/requirements.sh" "$work/requirements.txt" seampact-fastapi generate uvicorn
python3 -m venv "$work/venv"
"$work/venv/bin/python" -m pip install --no-input --disable-pip-version-check --require-hashes --no-deps \
  --only-binary :all: -r "$work/requirements.txt"

# uv takes a name from the first index that has it, so a seampact name on the local index never comes from PyPI;
# `--no-build` makes a missing wheel fail rather than build from the sdist.
uv pip install --no-cache --no-build --python "$work/venv/bin/python" ${local_index:+--index "$local_index"} --default-index "$pypi" \
  "seampact-fastapi[generate]==$version" "seampact-signed-webhooks==$version" "seampact-ir[compiler]==$version"
"$work/venv/bin/python" -m pip check
uv pip list --python "$work/venv/bin/python" --format freeze | grep '^seampact' | tee "$work/installed.txt"
if grep -v "==$version\$" "$work/installed.txt"; then
  echo "fastapi: the seampact distributions above are not at $version." >&2
  exit 1
fi

# No SEAMPACT_CONSUMER_BINARY: the binary is the one the pins of seampact-ir name, from the seampact-compiler wheel.
env -u SEAMPACT_CONSUMER_BINARY sh "$consumers/targets/fastapi/assemble.sh" "$work" "$bundled"
(cd "$work/app" && "$work/venv/bin/seampact" generate)
echo "fastapi: the consumer in $work/app installed seampact-* $version${local_index:+ from $local_index} and generated"
