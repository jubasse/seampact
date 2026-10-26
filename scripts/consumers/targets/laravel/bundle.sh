#!/bin/sh
# Bundles the reference contract with the compiler binary (ADR 0011 "Bundles"), so the PHP jobs need no Node:
# `bundle.sh <binary> <out>` writes the bundle to <out>/bundle and its integrity pin to <out>/integrity; <out> is new.
set -eu

binary="$1"
out="$2"
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../.." && pwd)
sources="$out/sources"

if [ -e "$out" ]; then
  echo "bundle.sh: $out exists; give a new directory." >&2
  exit 1
fi
mkdir -p "$sources"
cp -R "$repo/fixtures/reference" "$sources/contract"
printf 'openapi: none\nsources:\n  contract: { path: contract }\n' > "$sources/seampact.config.yaml"

integrity=$(cd "$sources" && "$binary" bundle --out "$out/bundle" --name @seampact/reference --version 1.0.0 | sed -n 's/^integrity: //p')
if [ -z "$integrity" ]; then
  echo "bundle.sh: the binary printed no integrity." >&2
  exit 1
fi

printf '%s\n' "$integrity" > "$out/integrity"
