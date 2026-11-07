#!/usr/bin/env bash
# The JVM consumers of the registry proof: the Spring Boot consumer (scripts/consumers/targets/spring-boot) built by
# the Gradle plugin into <work-dir>/gradle/build/libs/consumer.jar, or by the Maven plugin into
# <work-dir>/maven/target/consumer.jar, resolving the seampact plugin, seampact-hooks and the seampact-spring-runtime
# the plugin adds from the rehearsal's file repository alone, or with `registries` from Maven Central and the Gradle
# Plugin Portal, and Spring Boot from those two. With the file repository the compiler is the release binary given,
# pinned by its hash; with `registries` the consumer pins nothing, so the plugin resolves the compiler artefact of its
# own pin from Maven Central.
#   scripts/release/registry-proof/spring-boot.sh <gradle|maven> <file-repository>|registries <version> <work-dir>
#     [<compiler-binary>]
set -euo pipefail

REGISTRIES=registries
USAGE="usage: $0 <gradle|maven> <file-repository>|$REGISTRIES <version> <work-dir> [<compiler-binary>]"

if [ $# -lt 4 ] || [ $# -gt 5 ]; then
  echo "$USAGE" >&2
  exit 2
fi

build_tool="$1"
case "$build_tool" in
  gradle | maven) ;;
  *) echo "spring-boot: the build tool is '$build_tool'; $USAGE" >&2; exit 2 ;;
esac

version="$3"
work="$4"
consumer="$(cd "$(dirname "$0")/../../consumers/targets/spring-boot" && pwd)"

if [ "$2" = "$REGISTRIES" ]; then
  if [ $# -eq 5 ]; then
    echo "spring-boot: with $REGISTRIES the compiler comes from Maven Central; give no <compiler-binary>." >&2
    exit 2
  fi
  repository_url=""
  source_name="Maven Central and the Gradle Plugin Portal"
else
  if [ $# -ne 5 ]; then
    echo "spring-boot: with a file repository, give the release <compiler-binary>; $USAGE" >&2
    exit 2
  fi
  repository_url="file://$(cd "$2" && pwd)"
  source_name="$repository_url"
  binary="$(cd "$(dirname "$5")" && pwd)/$(basename "$5")"
  binary_sha256="$(sha256sum "$binary" | cut -d ' ' -f 1)"
  chmod +x "$binary"
fi
# Only the release repository serves seampact's group, so nothing resolves from a build or a local repository.
seampact_group='io\\.github\\.jubasse(\\..*)?'

mkdir -p "$work"

# Without the consumer's path pin, the build file's own binary block, so the plugin uses the pin it ships.
drop_gradle_pin() {
  awk '/^import java.security.MessageDigest$/ { next } /^val compilerBinary/ { skip = 1 } skip && /^seampact [{]/ { block = 1 } !skip { print } block && /^[}]$/ { skip = 0; block = 0 }' \
    "$1/build.gradle.kts" > "$1/build.gradle.kts.new"
  mv "$1/build.gradle.kts.new" "$1/build.gradle.kts"
  # The pin gone and the blocks after it kept: a block of another form would drop the rest of the file.
  if grep -q 'binary {' "$1/build.gradle.kts" || ! grep -q '^tasks.bootJar {' "$1/build.gradle.kts"; then
    echo "spring-boot: the consumer's build.gradle.kts binary block changed form; the pin was not removed alone." >&2
    exit 1
  fi
}

drop_maven_pin() {
  sed '/^        <configuration>$/,/^        <\/configuration>$/d' "$1/pom.xml" > "$1/pom.xml.new"
  mv "$1/pom.xml.new" "$1/pom.xml"
  if grep -q '<binary>' "$1/pom.xml"; then
    echo "spring-boot: the consumer's pom.xml still pins a binary; its plugin configuration changed form." >&2
    exit 1
  fi
}

build_gradle() {
gradle_app="$work/gradle"
rm -rf "$gradle_app"
sh "$consumer/assemble.sh" "$gradle_app" "" gradle
# The rehearsal's repository block: only the release file repository serves seampact's group.
release_repository=""
if [ -n "$repository_url" ]; then
  release_repository="exclusiveContent {
            forRepository { maven { url = uri(\"$repository_url\") } }
            filter { includeGroupByRegex(\"$seampact_group\") }
        }"
fi
cat > "$gradle_app/settings.gradle.kts" <<KOTLIN
// The proof's settings: the seampact plugin at the release version from $source_name.
pluginManagement {
    repositories {
        $release_repository
        gradlePluginPortal()
        mavenCentral()
    }
    plugins {
        id("io.github.jubasse.seampact") version "$version"
    }
}

rootProject.name = "consumer"
KOTLIN
cat >> "$gradle_app/build.gradle.kts" <<KOTLIN

// The proof's repositories: seampact's modules at the release version from $source_name.
repositories {
    $release_repository
}

dependencies { implementation("io.github.jubasse:seampact-hooks:$version") }
KOTLIN
if [ -n "$repository_url" ]; then
  (cd "$gradle_app" && ./gradlew --no-daemon build -PseampactBinary="$binary")
else
  drop_gradle_pin "$gradle_app"
  (cd "$gradle_app" && ./gradlew --no-daemon build)
  compiler_cache="${GRADLE_USER_HOME:-$HOME/.gradle}/caches/modules-2/files-2.1/io.github.jubasse/seampact-compiler/$version"
  if [ ! -d "$compiler_cache" ]; then
    echo "spring-boot: the Gradle build resolved no seampact-compiler $version into $compiler_cache." >&2
    exit 1
  fi
fi
echo "spring-boot: the Gradle consumer built with the release artefacts of $source_name"
}

build_maven() {
maven_app="$work/maven"
rm -rf "$maven_app" "$work/m2"
sh "$consumer/assemble.sh" "$maven_app" "" maven
# The rehearsal's profile adds the release file repository under the id `release`; without it, Maven Central's id is
# `central`. Either way the settings are this file alone, not the machine's.
if [ -n "$repository_url" ]; then
  expected_repository=release
  cat > "$work/maven-settings.xml" <<XML
<settings>
  <profiles>
    <profile>
      <id>release-rehearsal</id>
      <repositories>
        <repository><id>release</id><url>$repository_url</url></repository>
      </repositories>
      <pluginRepositories>
        <pluginRepository><id>release</id><url>$repository_url</url></pluginRepository>
      </pluginRepositories>
    </profile>
  </profiles>
  <activeProfiles><activeProfile>release-rehearsal</activeProfile></activeProfiles>
</settings>
XML
else
  expected_repository=central
  echo '<settings/>' > "$work/maven-settings.xml"
fi
# A fresh local repository, so no module published to Maven local by another build is taken.
maven=(./mvnw -B -s "$work/maven-settings.xml" -Dmaven.repo.local="$work/m2" package -Dseampact.version="$version")
if [ -n "$repository_url" ]; then
  (cd "$maven_app" && "${maven[@]}" -DseampactBinary="$binary" -DseampactBinarySha256="$binary_sha256")
else
  drop_maven_pin "$maven_app"
  (cd "$maven_app" && "${maven[@]}")
  if [ ! -d "$work/m2/io/github/jubasse/seampact-compiler/$version" ]; then
    echo "spring-boot: the Maven build resolved no seampact-compiler $version into $work/m2." >&2
    exit 1
  fi
fi

# Maven has no per-group repository filter, so the local repository's record of where each file came from is read:
# a seampact file resolved from any repository but the expected one (Central, on a rehearsal rerun after the
# release) fails.
seampact_records="$(find "$work/m2/io/github/jubasse" -name _remote.repositories 2>/dev/null || true)"
if [ -z "$seampact_records" ]; then
  echo "spring-boot: the Maven build resolved no io.github.jubasse module into $work/m2" >&2
  exit 1
fi
# shellcheck disable=SC2086 # one record path per word: find prints no spaces in a Maven layout
foreign_sources="$(grep -H '>' $seampact_records | { grep -v ">$expected_repository=\$" || [ $? -eq 1 ]; })"
if [ -n "$foreign_sources" ]; then
  echo "spring-boot: the Maven build resolved io.github.jubasse files from another repository than $source_name:" >&2
  echo "$foreign_sources" >&2
  exit 1
fi
echo "spring-boot: the Maven consumer built with the release artefacts of $source_name"
}

"build_$build_tool"
