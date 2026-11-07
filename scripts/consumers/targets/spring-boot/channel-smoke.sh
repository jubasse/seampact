#!/bin/sh
# The JVM legs of the channel smoke tests (ADR 0011 "Channel smoke tests"): with the channels `scripts/dist-smoke/cli.ts
# serve` started and its JSON line in <served>, `channel-smoke.sh <served> <gradle|maven> <work> <repository jvm/>`
# assembles the consumer for each of the release and git channels, generates and checks it from the served bundle,
# and expects the tampered copy served by the same channel to be refused as `bundle.file-hash`. The plugin's bundle
# cache is emptied before each run: it is keyed by integrity, which the tampered copy shares. The Maven leg takes
# the plugin from Maven local.
set -eu

served="$1"
build_tool="$2"
work="$3"
seampact_jvm="$4"
here=$(cd "$(dirname "$0")" && pwd)

integrity=$(jq -r .integrity "$served")
tampered_file=$(jq -r .tamperedFile "$served")
release_url=$(jq -r .release.url "$served")
release_tampered_url=$(jq -r .release.tamperedUrl "$served")
git_url=$(jq -r .git.url "$served")
git_tag=$(jq -r .git.tag "$served")
git_tampered_tag=$(jq -r .git.tamperedTag "$served")
git_directory=$(jq -r .git.directory "$served")

# The app is compiled for the Java the smoke runs on, so no other toolchain is needed.
java_version=$(java -XshowSettings:properties -version 2>&1 | sed -n 's/^ *java.specification.version = //p')

mkdir -p "$work"
sh "$here/trust-store.sh" "$(jq -r .release.caFile "$served")" "$work/truststore.p12"
export JAVA_TOOL_OPTIONS="-Djavax.net.ssl.trustStore=$work/truststore.p12 -Djavax.net.ssl.trustStorePassword=changeit"

# A bundle source is read with no compiler, so the pinned binary is a placeholder the run never installs.
placeholder_binary="$work/no-compiler"
printf 'A bundle source needs no compiler.\n' > "$placeholder_binary"
placeholder_sha256=$(sha256sum "$placeholder_binary" | cut -d' ' -f1)

release_source() {
  printf '  contract:\\n    release: { url: "%s" }\\n    integrity: %s' "$1" "$integrity"
}

git_source() {
  printf '  contract:\\n    git: { url: "%s", tag: "%s", directory: "%s" }\\n    integrity: %s' "$git_url" "$1" "$git_directory" "$integrity"
}

# Generates and checks the app in <app>, writing the output to <app>/run.log.
generate_and_check() {
  app="$1"
  if [ "$build_tool" = "maven" ]; then
    rm -rf "$HOME/.m2/seampact/bundles"
    (cd "$app" && ./mvnw -B generate-sources io.github.jubasse:seampact-maven-plugin:check -Djava.version="$java_version" -DseampactBinary="$placeholder_binary" \
      -DseampactBinarySha256="$placeholder_sha256") > "$app/run.log" 2>&1
  else
    rm -rf "${GRADLE_USER_HOME:-$HOME/.gradle}/caches/seampact/bundles"
    (cd "$app" && ./gradlew seampactGenerate seampactCheck -PjavaVersion="$java_version" -PseampactJvm="$seampact_jvm" \
      -PseampactBinary="$placeholder_binary") > "$app/run.log" 2>&1
  fi
}

# Runs one case: `pass` expects a generated and checked app, `tampered` the refusal naming the tampered file.
run_case() {
  name="$1"
  source_lines="$2"
  expected="$3"
  app="$work/$name"

  rm -rf "$app"
  sh "$here/assemble.sh" "$app" "" "$build_tool"
  sh "$here/contract-source.sh" "$app" "$source_lines"

  if generate_and_check "$app"; then outcome=pass; else outcome=refused; fi

  if [ "$expected" = "pass" ] && [ "$outcome" = "pass" ]; then
    echo "$build_tool $name: generated and checked from the bundle."
  elif [ "$expected" = "tampered" ] && [ "$outcome" = "refused" ] && grep -q 'bundle.file-hash' "$app/run.log" \
    && grep -qF "$tampered_file" "$app/run.log"; then
    echo "$build_tool $name: the tampered copy is refused as bundle.file-hash, naming $tampered_file."
  else
    echo "$build_tool $name: expected $expected, the run ended $outcome; its log:" >&2
    cat "$app/run.log" >&2
    exit 1
  fi
}

run_case release "$(release_source "$release_url")" pass
run_case release-tampered "$(release_source "$release_tampered_url")" tampered
run_case git "$(git_source "$git_tag")" pass
run_case git-tampered "$(git_source "$git_tampered_tag")" tampered
