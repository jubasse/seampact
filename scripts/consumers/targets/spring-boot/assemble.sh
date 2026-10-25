#!/bin/sh
# Copies the Spring Boot consumer into a directory of its own (ADR 0011, A12): the app sources, its Gradle build
# root, the repository's Gradle wrapper and the reference contract. `allow-listed` takes the config of the
# `allow-listed-framework-route` boot variant; `pack-spring` takes the reference contract with `@seampact/pack-spring`
# applied, its paged lists answered with Spring Data's `Page` (the `pack:spring` suite profile).
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

if [ "$variant" = "pack-spring" ]; then
  cp -R "$repository/fixtures/golden/pack-spring/contract" "$destination/contract"
  cp -R "$here/pack-spring/src" "$destination/"
  printf '\ndependencies { implementation("org.springframework.data:spring-data-commons") }\n' >> "$destination/build.gradle.kts"
else
  cp -R "$repository/fixtures/reference" "$destination/contract"
fi

if [ "$variant" = "allow-listed" ]; then
  cp "$here/seampact.allow-listed.config.yaml" "$destination/seampact.config.yaml"
else
  cp "$here/seampact.config.yaml" "$destination/seampact.config.yaml"
fi
