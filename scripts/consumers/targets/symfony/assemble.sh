#!/bin/sh
# Assembles the Symfony consumer in <work>: `assemble.sh <work> <bundled> <symfony>
# [allow-listed|route-check-off|hook-check-off|pack-laravel]` copies the app into <work>/app (or <work>/app-<variant>
# for a boot variant's app, built from `seampact.<variant>.config.yaml`; `hook-check-off` without the `health`
# controller, since its generated code has no `AppEndpoints`; or <work>/app-pack-laravel, whose paged lists answer the
# pack's page facts from `pack-laravel/src`) on Symfony <symfony> (7.4, or 8 on the PHP 8.5 platform), points its path
# repositories at the repository's php/ packages, and points its contract at the bundle that `../../php/bundle.sh`
# wrote to <bundled> (for pack-laravel, the bundle of fixtures/golden/pack-laravel/contract), committed into the local
# git repository <work>/contract-repo (<work>/contract-repo-pack-laravel) with the tag v1.0.0. The app directory is new.
set -eu

work="$1"
bundled="$2"
symfony="$3"
variant="${4:-}"
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../.." && pwd)
suite_package=$(cd "$here/../../php/suite" && pwd)
contract_repo="$work/contract-repo"

case "$variant" in
  "") app="$work/app"; config="seampact.config.yaml" ;;
  allow-listed | route-check-off | hook-check-off) app="$work/app-$variant"; config="seampact.$variant.config.yaml" ;;
  pack-laravel) app="$work/app-pack-laravel"; config="seampact.config.yaml"; contract_repo="$work/contract-repo-pack-laravel" ;;
  *) echo "usage: assemble.sh <work> <bundled> <7.4|8> [allow-listed|route-check-off|hook-check-off|pack-laravel]" >&2; exit 1 ;;
esac

# The Symfony 8 row moves the platform too: Symfony 8 needs PHP 8.4.
case "$symfony" in
  7.4) constraint="~7.4.0"; platform="8.3.36" ;;
  8) constraint="~8.1.0"; platform="8.5.12" ;;
  *) echo "usage: assemble.sh <work> <bundled> <7.4|8> [allow-listed|route-check-off|hook-check-off|pack-laravel]" >&2; exit 1 ;;
esac

if [ -e "$app" ]; then
  echo "assemble.sh: $app exists; give a new work directory." >&2
  exit 1
fi

if [ ! -d "$contract_repo" ]; then
  mkdir -p "$contract_repo"
  cp -R "$bundled/bundle" "$contract_repo/bundle"
  git -C "$contract_repo" init -q
  git -C "$contract_repo" add bundle
  git -C "$contract_repo" -c user.name=seampact -c user.email=seampact@localhost commit -qm "Bundle the reference contract."
  git -C "$contract_repo" tag v1.0.0
fi

mkdir -p "$app/var"
cp -R "$here/bin" "$here/public" "$here/src" "$here/composer.json" "$app/"
cp "$here/$config" "$app/seampact.config.yaml"
if [ "$variant" = "pack-laravel" ]; then
  cp -R "$here/pack-laravel/src" "$app/"
fi
if [ "$variant" = "hook-check-off" ]; then
  rm "$app/src/Controller/AppController.php"
fi
cp "$here/../spring-boot/credentials.json" "$app/credentials.json"

sed -e "s#\"\.\./\.\./php/suite\"#\"$suite_package\"#" -e "s#\"\.\./\.\./\.\./\.\./php/#\"$repo/php/#" -e "s#\"~7\.4\.0\"#\"$constraint\"#" -e "s#\"php\": \"8\.3\.36\"#\"php\": \"$platform\"#" \
  "$app/composer.json" > "$app/composer.json.new"
mv "$app/composer.json.new" "$app/composer.json"

integrity=$(cat "$bundled/integrity")
"$here/../spring-boot/contract-source.sh" "$app" \
  "  contract:\n    git: { url: \"$contract_repo\", tag: v1.0.0, directory: bundle }\n    integrity: \"$integrity\""
