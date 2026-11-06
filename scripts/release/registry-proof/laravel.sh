#!/usr/bin/env bash
# The Laravel consumer of the registry proof: the consumer of scripts/consumers/targets/laravel with seampact/hooks,
# seampact/laravel and seampact/signed-webhooks (and through them seampact/codegen and seampact/ir) at the release
# version, from the rehearsal's bare mirrors or, without <bare-mirrors-dir>, from Packagist; then generated from the
# bundle and cached as a deployed app is. The suite serves <work>/app.
#   scripts/release/registry-proof/laravel.sh <bundled> <version> <work> [<bare-mirrors-dir>]
set -euo pipefail

if [ $# -lt 3 ] || [ $# -gt 4 ]; then
  echo "usage: $0 <bundled> <version> <work> [<bare-mirrors-dir>]" >&2
  exit 2
fi

bundled="$1"
version="$2"
work="$3"
mirrors="${4:-}"
here="$(cd "$(dirname "$0")" && pwd)"
consumers="$(cd "$here/../../consumers" && pwd)"

if [ -e "$work" ]; then
  echo "laravel: $work exists; give a new work directory." >&2
  exit 1
fi

mkdir -p "$work"
sh "$consumers/targets/laravel/assemble.sh" "$work" "$bundled"
cp -R "$consumers/php/suite" "$work/consumer-suite"
node "$here/composer-registry.ts" "$work/app" --suite "$work/consumer-suite" --version "$version" ${mirrors:+--mirrors "$mirrors"}

cd "$work/app"
composer update --no-interaction --no-progress --no-plugins --no-scripts
vendor/bin/seampact generate
php artisan route:cache
php artisan config:cache

# Each installed seampact package but the suite doubles is the released one; Composer records a tag `v<version>`.
foreign="$(jq -r --arg version "$version" '.packages[] | select(.name | startswith("seampact/"))
  | select(.name != "seampact/consumer-suite") | select((.version | ltrimstr("v")) != $version) | "\(.name) \(.version)"' vendor/composer/installed.json)"
if [ -n "$foreign" ]; then
  echo "laravel: these seampact packages are not at $version:" >&2
  echo "$foreign" >&2
  exit 1
fi
echo "laravel: the consumer in $work/app installed seampact/* $version${mirrors:+ from $mirrors} and generated"
