#!/bin/sh
# Points an assembled consumer's app config at a contract bundle: `contract-source.sh <app> <source>` replaces the
# config's `path` source with the YAML lines of <source> (the `contract:` key and its members, `\n`-separated) and
# removes the app's copy of the YAML sources, so the build can only read the bundle.
set -eu

app="$1"
source_lines="$2"
path_source='  contract: { path: contract }'
config="$app/seampact.config.yaml"

if ! grep -qxF "$path_source" "$config"; then
  echo "contract-source.sh: $config has no line '$path_source'." >&2
  exit 1
fi

awk -v path_source="$path_source" -v source_lines="$source_lines" \
  '$0 == path_source { print source_lines; next } { print }' "$config" > "$config.new"
mv "$config.new" "$config"
rm -rf "$app/contract"
