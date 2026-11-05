#!/usr/bin/env bash
# The JVM staging bundles of a release, signed with the key of ORG_GRADLE_PROJECT_seampactSigningKey (and its
# passphrase ORG_GRADLE_PROJECT_seampactSigningPassword): <out-dir>/central holds every module but the Gradle plugin,
# the compiler's five binaries from <assets-dir> checked against its SHA256SUMS among them, and <out-dir>/plugin-portal
# the Gradle plugin and its marker, after `validatePlugins`. Each plugin jar embeds the pin of that SHA256SUMS. The
# version is the stamped one of jvm/gradle.properties, which the caller has checked. maven-metadata.xml is left out:
# Central writes its own.
#   scripts/release/jvm/stage.sh <assets-dir> <out-dir>
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "usage: $0 <assets-dir> <out-dir>" >&2
  exit 2
fi

assets="$(cd "$1" && pwd)"
out="$(mkdir -p "$2" && cd "$2" && pwd)"
jvm="$(cd "$(dirname "$0")/../../../jvm" && pwd)"
version="$(sed -n 's/^version=//p' "$jvm/gradle.properties")"
plugin_module=seampact-gradle-plugin

if [ -z "$version" ]; then
  echo "stage: $jvm/gradle.properties has no version: stamp the checkout first." >&2
  exit 1
fi

if [ -z "${ORG_GRADLE_PROJECT_seampactSigningKey:-}" ]; then
  echo "stage: ORG_GRADLE_PROJECT_seampactSigningKey is not set: a release bundle is signed." >&2
  exit 1
fi

rm -rf "$out/central" "$out/plugin-portal"

# No configuration cache: it would store the signing key on disk.
gradle=("$jvm/gradlew" -p "$jvm" --no-configuration-cache --no-build-cache
  "-PseampactBinarySums=$assets/SHA256SUMS" "-PseampactCompilerVersion=$version")

central_tasks=()
for module in $(sed -n 's/^include("\(seampact-[a-z-]*\)")$/\1/p' "$jvm/settings.gradle.kts" | grep -vx "$plugin_module"); do
  central_tasks+=(":$module:publishAllPublicationsToReleaseRepository")
done

"${gradle[@]}" "${central_tasks[@]}" "-PseampactReleaseRepository=$out/central" "-PseampactBinariesDir=$assets"
"${gradle[@]}" ":$plugin_module:validatePlugins" ":$plugin_module:publishAllPublicationsToReleaseRepository" \
  "-PseampactReleaseRepository=$out/plugin-portal"

find "$out/central" "$out/plugin-portal" -name 'maven-metadata.xml*' -delete
echo "stage: $version staged in $out/central and $out/plugin-portal"
