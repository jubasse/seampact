#!/bin/sh
# Builds a wheel of every uv workspace member of `python/` except `seampact-compiler` into <out-dir>
# (ADR 0011 "Unpublished installs for test consumers"): the compiler wheel is built only by `p3-binary.yml`, from the
# release binaries, and its build hook refuses to run without them. The members come from `python/pyproject.toml`.
# Run it from anywhere; a failed build fails the script.
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: build-wheels.sh <out-dir>" >&2
  exit 2
fi

here=$(cd "$(dirname "$0")" && pwd)
workspace=$(cd "$here/../../../python" && pwd)
excluded="seampact-compiler"

packages=$(python3 -I - "$workspace" "$excluded" <<'PY'
import sys
import tomllib
from pathlib import Path

workspace = Path(sys.argv[1])
excluded = sys.argv[2]
members = tomllib.loads((workspace / "pyproject.toml").read_text())["tool"]["uv"]["workspace"]["members"]

for member in members:
    name = tomllib.loads((workspace / member / "pyproject.toml").read_text())["project"]["name"]
    if name != excluded:
        print(name)
PY
)

mkdir -p "$1"
out=$(cd "$1" && pwd)

cd "$workspace"
for package in $packages; do
  uv build --wheel --package "$package" --out-dir "$out"
done
