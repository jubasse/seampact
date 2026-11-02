#!/bin/sh
# Assembles a Python consumer in <work>: `assemble.sh <target> <work> <bundled> [allow-listed]` copies the app of the
# consumer directory <target> and the shared suite doubles into <work>/app (or <work>/app-allow-listed, built from the
# target's `seampact.allow-listed.config.yaml`), and points its contract at the bundle that `bundle.sh` wrote to
# <bundled>, committed into the local git repository <work>/contract-repo with the tag v1.0.0. The app directory is new.
# With SEAMPACT_CONSUMER_BINARY set to a compiler binary, the app's pyproject.toml pins it as `[tool.seampact.binary]`,
# which the runner needs for `nativeDocs` until the binary is published.
set -eu

target=$(cd "$1" && pwd)
work="$2"
bundled="$3"
variant="${4:-}"
here=$(cd "$(dirname "$0")" && pwd)
suite_package="$here/suite/seampact_consumer_suite"
spring_boot="$here/../targets/spring-boot"
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
cp -R "$target/app/." "$app/"
cp -R "$suite_package" "$app/"
cp "$target/$config" "$app/seampact.config.yaml"
cp "$spring_boot/credentials.json" "$app/credentials.json"

if [ -n "${SEAMPACT_CONSUMER_BINARY:-}" ]; then
  binary=$(cd "$(dirname "$SEAMPACT_CONSUMER_BINARY")" && pwd)/$(basename "$SEAMPACT_CONSUMER_BINARY")
  sha256=$(sha256sum "$binary" | cut -d " " -f 1)
  printf '[project]\nname = "seampact-consumer"\nversion = "0"\n\n[tool.seampact.binary]\npath = "%s"\nsha256 = "%s"\n' \
    "$binary" "$sha256" > "$app/pyproject.toml"
fi

integrity=$(cat "$bundled/integrity")
"$spring_boot/contract-source.sh" "$app" \
  "  contract:\n    git: { url: \"$contract_repo\", tag: v1.0.0, directory: bundle }\n    integrity: \"$integrity\""
