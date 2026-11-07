#!/bin/sh
# Installs a Python consumer as a user would (ADR 0011 "Unpublished installs for test consumers"): `install.sh <venv>
# <requirements> <wheels> <distribution> [<pins>]` makes the virtual environment <venv>, installs the third-party
# <requirements> from PyPI by hash (a full closure, so none brings its own dependencies), then the hash-pinned <pins>
# over them (a floor row's framework versions), then <distribution> (`seampact-fastapi[generate]`) from the wheels
# that `build-wheels.sh` wrote to <wheels>, never looking a seampact name up on an index. <venv> is new.
set -eu

venv="$1"
requirements="$2"
wheels="$3"
distribution="$4"
pins="${5:-}"

if [ -e "$venv" ]; then
  echo "install.sh: $venv exists; give a new directory." >&2
  exit 1
fi

python3 -m venv "$venv"
python="$venv/bin/python"

third_party() {
  "$python" -m pip install --no-input --disable-pip-version-check --require-hashes --no-deps --only-binary :all: -r "$1"
}

third_party "$requirements"
if [ -n "$pins" ]; then
  third_party "$pins"
fi

"$python" -m pip install --no-input --disable-pip-version-check --no-index --find-links "$wheels" "$distribution"
"$python" -m pip check
