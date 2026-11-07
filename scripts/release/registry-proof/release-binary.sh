#!/usr/bin/env bash
# Downloads the linux-x64 compiler binary and SHA256SUMS of a published GitHub release into <dir> and checks the
# binary against SHA256SUMS: the binary the post-release consumers bundle with and pin by its hash.
#   scripts/release/registry-proof/release-binary.sh <version> <dir>
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: $0 <version> <dir>" >&2
  exit 2
fi

version="$1"
dir="$2"
release_url="https://github.com/jubasse/seampact/releases/download/v$version"
binary=seampact-linux-x64

mkdir -p "$dir"
for asset in "$binary" SHA256SUMS; do
  curl --silent --show-error --fail --location --retry 3 --output "$dir/$asset" "$release_url/$asset"
done

if ! grep -q " \*\?$binary\$" "$dir/SHA256SUMS"; then
  echo "release-binary: SHA256SUMS of v$version lists no $binary." >&2
  exit 1
fi
(cd "$dir" && sha256sum --check --ignore-missing --strict SHA256SUMS)
chmod +x "$dir/$binary"
echo "release-binary: $dir/$binary is the $binary of v$version, as its SHA256SUMS lists it"
