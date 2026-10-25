#!/bin/sh
# Copies the Spring Boot consumer into a directory of its own (ADR 0011, A12): the app sources, its Gradle build
# root, the repository's Gradle wrapper and the reference contract. `allow-listed` takes the config of the
# `allow-listed-framework-route` boot variant.
set -eu

destination="$1"
variant="${2:-}"
here=$(cd "$(dirname "$0")" && pwd)
repository=$(cd "$here/../../../.." && pwd)

mkdir -p "$destination/src/main/resources" "$destination/gradle"
cp -R "$here/src" "$destination/"
cp "$here/gradle/settings.gradle.kts" "$here/gradle/build.gradle.kts" "$destination/"
cp "$here/credentials.json" "$destination/src/main/resources/credentials.json"
cp "$repository/jvm/gradlew" "$destination/gradlew"
cp -R "$repository/jvm/gradle/wrapper" "$destination/gradle/"
cp -R "$repository/fixtures/reference" "$destination/contract"

if [ "$variant" = "allow-listed" ]; then
  cp "$here/seampact.allow-listed.config.yaml" "$destination/seampact.config.yaml"
else
  cp "$here/seampact.config.yaml" "$destination/seampact.config.yaml"
fi
