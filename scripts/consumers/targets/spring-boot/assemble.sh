#!/bin/sh
# Copies the Spring Boot consumer into a directory of its own (ADR 0011, A12): the app sources, its build root (Gradle
# with the repository's Gradle wrapper, or Maven with its `mvnw`) and the reference contract. `allow-listed` takes the
# config of the `allow-listed-framework-route` boot variant; `pack-spring` takes the reference contract with
# `@seampact/pack-spring` applied, its paged lists answered with Spring Data's `Page` (the `pack:spring` suite profile);
# `pack-laravel` the reference contract with `@seampact/pack-laravel` applied, whose format wraps every success body
# (the `pack:laravel` suite profile).
set -eu

destination="$1"
variant="${2:-}"
build_tool="${3:-gradle}"
here=$(cd "$(dirname "$0")" && pwd)
repository=$(cd "$here/../../../.." && pwd)

case "$build_tool" in
  gradle | maven) ;;
  *)
    echo "assemble.sh: the build tool is '$build_tool'; pass gradle or maven." >&2
    exit 1
    ;;
esac

# The pack-spring variant's Spring Data Commons, added to the build file the build tool reads.
add_spring_data_commons() {
  if [ "$build_tool" = "maven" ]; then
    spring_data='    <dependency><groupId>org.springframework.data</groupId><artifactId>spring-data-commons</artifactId></dependency>'
    awk -v dependency="$spring_data" '/^  <\/dependencies>$/ { print dependency } { print }' "$destination/pom.xml" > "$destination/pom.xml.new"
    mv "$destination/pom.xml.new" "$destination/pom.xml"
    grep -q 'spring-data-commons' "$destination/pom.xml" || { echo "assemble: no </dependencies> line indented by two spaces in the consumer pom.xml, spring-data-commons was not added" >&2; exit 1; }
  else
    printf '\ndependencies { implementation("org.springframework.data:spring-data-commons") }\n' >> "$destination/build.gradle.kts"
  fi
}

mkdir -p "$destination/src/main/resources"
cp -R "$here/src" "$destination/"
cp "$here/credentials.json" "$destination/src/main/resources/credentials.json"

if [ "$build_tool" = "maven" ]; then
  cp "$here/maven/pom.xml" "$here/maven/mvnw" "$destination/"
  cp -R "$here/maven/.mvn" "$destination/"
else
  mkdir -p "$destination/gradle"
  cp "$here/gradle/settings.gradle.kts" "$here/gradle/build.gradle.kts" "$destination/"
  cp "$repository/jvm/gradlew" "$destination/gradlew"
  cp -R "$repository/jvm/gradle/wrapper" "$destination/gradle/"
fi

if [ "$variant" = "pack-spring" ]; then
  cp -R "$repository/fixtures/golden/pack-spring/contract" "$destination/contract"
  cp -R "$here/pack-spring/src" "$destination/"
  add_spring_data_commons
elif [ "$variant" = "pack-laravel" ]; then
  cp -R "$repository/fixtures/golden/pack-laravel/contract" "$destination/contract"
  cp -R "$here/pack-laravel/src" "$destination/"
else
  cp -R "$repository/fixtures/reference" "$destination/contract"
fi

if [ "$variant" = "allow-listed" ]; then
  cp "$here/seampact.allow-listed.config.yaml" "$destination/seampact.config.yaml"
else
  cp "$here/seampact.config.yaml" "$destination/seampact.config.yaml"
fi
