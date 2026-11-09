#!/bin/sh
# Assembles the API Platform consumer in <work>: `assemble.sh <work> <bundled> <7.4|8>` assembles the Symfony consumer
# there (`../symfony/assemble.sh`), then derives the API Platform one from it (`derive.php`): its Kernel serves the
# generated operations through API Platform's routes, its config uses `seampact/api-platform`, and its composer.json
# adds API Platform 5 and the path repository of `php/api-platform`. The app directory is <work>/app and is new.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../.." && pwd)

if [ "$#" -ne 3 ]; then
  echo "usage: assemble.sh <work> <bundled> <7.4|8>" >&2
  exit 1
fi

"$here/../symfony/assemble.sh" "$1" "$2" "$3"
php "$here/derive.php" "$1/app" "$repo"
