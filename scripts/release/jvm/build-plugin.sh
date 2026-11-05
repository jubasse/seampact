#!/usr/bin/env bash
# Builds the files of the Gradle plugin's publications, with the pin of <assets-dir>/SHA256SUMS and the flags stage.sh
# builds them with, so a fresh checkout reproduces build-jvm's bytes; any further task (`publishPlugins`) runs in the
# same build. The version is the stamped one of jvm/gradle.properties.
#   scripts/release/jvm/build-plugin.sh <assets-dir> [task...]
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <assets-dir> [task...]" >&2
  exit 2
fi

assets="$(cd "$1" && pwd)"
shift
jvm="$(cd "$(dirname "$0")/../../../jvm" && pwd)"
version="$(sed -n 's/^version=//p' "$jvm/gradle.properties")"
plugin=:seampact-gradle-plugin

if [ -z "$version" ]; then
  echo "build-plugin: $jvm/gradle.properties has no version: stamp the checkout first." >&2
  exit 1
fi

"$jvm/gradlew" -p "$jvm" --no-configuration-cache --no-build-cache \
  "-PseampactBinarySums=$assets/SHA256SUMS" "-PseampactCompilerVersion=$version" \
  "$plugin:jar" "$plugin:sourcesJar" "$plugin:javadocJar" \
  "$plugin:generatePomFileForPluginMavenPublication" "$plugin:generateMetadataFileForPluginMavenPublication" \
  "$plugin:generatePomFileForSeampactPluginMarkerMavenPublication" \
  "${@/#/$plugin:}"
