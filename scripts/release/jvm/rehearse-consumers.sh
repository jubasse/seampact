#!/usr/bin/env bash
# The JVM consumers of the rehearsal: the Spring Boot consumer (scripts/consumers/targets/spring-boot) built once by
# the Gradle plugin and once by the Maven plugin, each resolving the seampact plugin, seampact-hooks and the
# seampact-spring-runtime the plugin adds from the release file repository alone, and Spring Boot from Maven Central
# and the Gradle Plugin Portal. The compiler is the release binary, pinned by its hash.
#   scripts/release/jvm/rehearse-consumers.sh <file-repository> <version> <compiler-binary> <work-dir>
set -euo pipefail

if [ $# -ne 4 ]; then
  echo "usage: $0 <file-repository> <version> <compiler-binary> <work-dir>" >&2
  exit 2
fi

repository_url="file://$(cd "$1" && pwd)"
version="$2"
binary="$(cd "$(dirname "$3")" && pwd)/$(basename "$3")"
work="$4"
consumer="$(cd "$(dirname "$0")/../../consumers/targets/spring-boot" && pwd)"
binary_sha256="$(sha256sum "$binary" | cut -d ' ' -f 1)"
# Only the release repository serves seampact's group, so nothing resolves from a build or a local repository.
seampact_group='io\\.github\\.jubasse(\\..*)?'

mkdir -p "$work"
chmod +x "$binary"

gradle_app="$work/gradle"
rm -rf "$gradle_app"
sh "$consumer/assemble.sh" "$gradle_app" "" gradle
cat > "$gradle_app/settings.gradle.kts" <<KOTLIN
// The rehearsal's settings: the seampact plugin at the release version from the release file repository.
pluginManagement {
    repositories {
        exclusiveContent {
            forRepository { maven { url = uri("$repository_url") } }
            filter { includeGroupByRegex("$seampact_group") }
        }
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

// The rehearsal's repositories: seampact's modules from the release file repository at the release version.
repositories {
    exclusiveContent {
        forRepository { maven { url = uri("$repository_url") } }
        filter { includeGroupByRegex("$seampact_group") }
    }
}

dependencies { implementation("io.github.jubasse:seampact-hooks:$version") }
KOTLIN
(cd "$gradle_app" && ./gradlew --no-daemon build -PseampactBinary="$binary")
echo "rehearse-consumers: the Gradle consumer built with the release artefacts of $repository_url"

maven_app="$work/maven"
rm -rf "$maven_app"
sh "$consumer/assemble.sh" "$maven_app" "" maven
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
# A fresh local repository, so no module published to Maven local by another build is taken.
(cd "$maven_app" && ./mvnw -B -s "$work/maven-settings.xml" -Dmaven.repo.local="$work/m2" package \
  -Dseampact.version="$version" -DseampactBinary="$binary" -DseampactBinarySha256="$binary_sha256")

# Maven has no per-group repository filter, so the local repository's record of where each file came from is read:
# a seampact file resolved from any repository but the release one (Central, on a rerun after the release) fails.
seampact_records="$(find "$work/m2/io/github/jubasse" -name _remote.repositories 2>/dev/null || true)"
if [ -z "$seampact_records" ]; then
  echo "rehearse-consumers: the Maven build resolved no io.github.jubasse module into $work/m2" >&2
  exit 1
fi
# shellcheck disable=SC2086 # one record path per word: find prints no spaces in a Maven layout
foreign_sources="$(grep -H '>' $seampact_records | grep -v '>release=$' || true)"
if [ -n "$foreign_sources" ]; then
  echo "rehearse-consumers: the Maven build resolved io.github.jubasse files from another repository than $repository_url:" >&2
  echo "$foreign_sources" >&2
  exit 1
fi
echo "rehearse-consumers: the Maven consumer built with the release artefacts of $repository_url"
