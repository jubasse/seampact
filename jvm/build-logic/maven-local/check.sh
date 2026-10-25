#!/usr/bin/env bash
# The Maven local flow (ADR 0011 "Unpublished installs for test consumers"): publishes every JVM module to a Maven
# local repository, then a throwaway Gradle project that lists only that repository and Maven Central resolves each
# module with its dependencies, and the Gradle plugin through its marker. seampact-compiler is left out: it
# publishes the five release binaries, which only a release has.
#
# Usage: check.sh <maven local repository directory>
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <maven local repository directory>" >&2
  exit 2
fi

jvm_directory=$(cd "$(dirname "$0")/../.." && pwd)
local_repository=$(mkdir -p "$1" && cd "$1" && pwd)
group=io.github.jubasse
version=0.0.0
gradle_plugin_id=io.github.jubasse.seampact

modules=$(sed -n 's/^include("\(seampact-[a-z-]*\)")$/\1/p' "$jvm_directory/settings.gradle.kts" | grep -vx seampact-compiler)
if [ -z "$modules" ]; then
  echo "No module found in $jvm_directory/settings.gradle.kts." >&2
  exit 1
fi

publish_tasks=()
for module in $modules; do
  publish_tasks+=(":$module:publishToMavenLocal")
done
"$jvm_directory/gradlew" -p "$jvm_directory" --quiet "${publish_tasks[@]}" "-Dmaven.repo.local=$local_repository"

consumer=$(mktemp -d)
trap 'rm -rf "$consumer"' EXIT

dependencies=""
for module in $modules; do
  dependencies+="    \"seampactModules\"(\"$group:$module:$version\")"$'\n'
done
dependencies+="    \"seampactModules\"(\"$gradle_plugin_id:$gradle_plugin_id.gradle.plugin:$version\")"$'\n'

echo 'rootProject.name = "maven-local-consumer"' > "$consumer/settings.gradle.kts"
cat > "$consumer/build.gradle.kts" <<KOTLIN
repositories {
    mavenLocal()
    mavenCentral()
}

configurations.create("seampactModules")

dependencies {
$dependencies}

tasks.register("resolveSeampactModules") {
    val modules = configurations.getByName("seampactModules")
    inputs.files(modules)
    doLast {
        val seampactFiles = modules.files.map { it.name }.filter { it.startsWith("seampact-") }.sorted()
        println(seampactFiles.joinToString("\n"))
    }
}
KOTLIN

resolved=$("$jvm_directory/gradlew" -p "$consumer" --quiet resolveSeampactModules "-Dmaven.repo.local=$local_repository")

missing=""
for module in $modules; do
  grep -qx "$module-$version.jar" <<< "$resolved" || missing+=" $module"
done
if [ -n "$missing" ]; then
  echo "mavenLocal() did not resolve:$missing. Resolved: $resolved" >&2
  exit 1
fi

echo "mavenLocal() resolved every module: $(tr '\n' ' ' <<< "$resolved")"
