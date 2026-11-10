#!/bin/sh
# Assembles the API Platform consumer in <work>: `assemble.sh <work> <bundled> <7.4|8>` assembles the Symfony consumer
# there (`../symfony/assemble.sh`), then derives the API Platform one from it (`derive.php`): its Kernel serves the
# generated operations through API Platform's routes, its config uses `seampact/api-platform`, and its composer.json
# adds API Platform 5 and the path repository of `php/api-platform`. The app directory is <work>/app and is new.
# `assemble.sh <work> <bundled> <7.4|8> pack-api-platform` builds the pack variant instead: <bundled> is the bundle of
# fixtures/golden/pack-api-platform/contract, the Symfony consumer's paged-list variant (`pack-laravel`, whose handlers
# answer the page items and total) is assembled over it into <work>/app-pack-laravel, and derive.php turns that app into
# the API Platform one.
# `assemble.sh <work> <bundled> <7.4|8> allow-listed|route-check-off|hook-check-off` builds the boot variant's app in
# <work>/app-<variant>, the Symfony consumer's one derived the same way; the `boot` profile starts them.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../.." && pwd)

if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
  echo "usage: assemble.sh <work> <bundled> <7.4|8> [pack-api-platform|allow-listed|route-check-off|hook-check-off]" >&2
  exit 1
fi

case "${4:-}" in
  "") symfony_variant=""; app="$1/app" ;;
  pack-api-platform) symfony_variant="pack-laravel"; app="$1/app-pack-laravel" ;;
  allow-listed | route-check-off | hook-check-off) symfony_variant="$4"; app="$1/app-$4" ;;
  *) echo "usage: assemble.sh <work> <bundled> <7.4|8> [pack-api-platform|allow-listed|route-check-off|hook-check-off]" >&2; exit 1 ;;
esac

"$here/../symfony/assemble.sh" "$1" "$2" "$3" $symfony_variant
php "$here/derive.php" "$app" "$repo"
