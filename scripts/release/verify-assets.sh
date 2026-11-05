#!/usr/bin/env bash
# The check of the release assets before any upload: SHA256SUMS is the manifest the binary call hashed (and, in a
# real run, attested), and the five binaries match it (the binary package's own manifest check).
#   scripts/release/verify-assets.sh <assets-dir> <sums-sha256>
set -euo pipefail

assets="${1:?usage: scripts/release/verify-assets.sh <assets-dir> <sums-sha256>}"
expected="${2:-}"
repository="$(cd "$(dirname "$0")/../.." && pwd)"

if [ -z "$expected" ]; then
  echo "verify-assets: the binary call output no sums-sha256, so the assets cannot be matched to the ones it hashed." >&2
  exit 1
fi

actual="$(sha256sum "$assets/SHA256SUMS" | cut -d ' ' -f 1)"

if [ "$actual" != "$expected" ]; then
  echo "verify-assets: SHA256SUMS hashes $actual, but the binary call output $expected: these are not the assets it hashed, so nothing is uploaded." >&2
  exit 1
fi

node "$repository/packages/tools/binary/scripts/manifest.mjs" check "$assets"
