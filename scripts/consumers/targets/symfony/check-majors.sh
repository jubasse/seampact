#!/bin/sh
# Fails when an installed Symfony package of the app in <app> is off the row's major: `check-majors.sh <app> <7.4|8>`.
# The pins in composer.json hold the direct packages only; this holds the transitive ones. Polyfills and contracts
# have their own version lines. symfony/yaml, which seampact/ir reads YAML with, must be there and on the major too.
set -eu

app="$1"
symfony="$2"

case "$symfony" in
  7.4) prefix="7.4." ;;
  8) prefix="8." ;;
  *) echo "usage: check-majors.sh <app> <7.4|8>" >&2; exit 1 ;;
esac

off=$(composer show --working-dir="$app" --no-interaction 'symfony/*' \
  | awk -v prefix="$prefix" '$1 !~ /^symfony\/polyfill-/ && $1 !~ /-contracts$/ { version = $2; sub(/^v/, "", version); if (index(version, prefix) != 1) print $1 " " $2 }')

if ! composer show --working-dir="$app" --no-interaction symfony/yaml > /dev/null 2>&1; then
  echo "check-majors.sh: symfony/yaml is not installed; seampact/ir needs it." >&2
  exit 1
fi

if [ -n "$off" ]; then
  echo "check-majors.sh: these Symfony packages are off Symfony $symfony; pin them in composer.json:" >&2
  echo "$off" >&2
  exit 1
fi
