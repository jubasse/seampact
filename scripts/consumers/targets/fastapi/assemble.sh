#!/bin/sh
# Assembles the FastAPI consumer in <work>: `assemble.sh <work> <bundled> [allow-listed]` copies the app and the shared
# suite doubles into <work>/app (or <work>/app-allow-listed, built from `seampact.allow-listed.config.yaml`), and points
# its contract at the bundle that `bundle.sh` wrote to <bundled>, committed into the local git repository
# <work>/contract-repo with the tag v1.0.0. The app directory is new.
set -eu

work="$1"
bundled="$2"
variant="${3:-}"
here=$(cd "$(dirname "$0")" && pwd)
suite_package=$(cd "$here/../../python/suite/seampact_consumer_suite" && pwd)
contract_repo="$work/contract-repo"

case "$variant" in
  "") app="$work/app"; config="seampact.config.yaml" ;;
  allow-listed) app="$work/app-allow-listed"; config="seampact.allow-listed.config.yaml" ;;
  *) echo "usage: assemble.sh <work> <bundled> [allow-listed]" >&2; exit 1 ;;
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

mkdir -p "$app"
cp -R "$here/app/." "$app/"
cp -R "$suite_package" "$app/"
cp "$here/$config" "$app/seampact.config.yaml"
cp "$here/../spring-boot/credentials.json" "$app/credentials.json"

integrity=$(cat "$bundled/integrity")
"$here/../spring-boot/contract-source.sh" "$app" \
  "  contract:\n    git: { url: \"$contract_repo\", tag: v1.0.0, directory: bundle }\n    integrity: \"$integrity\""
