<!-- Generated from docs/backend/spring-boot.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Spring Boot

Page: https://jubasse.github.io/seampact/backend/spring-boot/

## Set up

The runtime, the hooks and the Maven plugin are on Maven Central under `io.github.jubasse`. The Gradle plugin is on the Gradle Plugin Portal. While the Portal reviews a new release, add Maven Central to the plugin repositories in `settings.gradle.kts`:

```kotlin
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}
```

Then, in `build.gradle.kts`:

```kotlin
plugins {
    java
    id("org.springframework.boot") version "4.1.1"
    id("io.github.jubasse.seampact")
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("io.github.jubasse:seampact-hooks")
}
```

In `seampact.config.yaml`, add one entry per api:

```yaml
targets:
  - id: notes
    use: io.github.jubasse:seampact-spring-boot
    api: notes
    options: { package: com.example.notes.api }
```

The records and the checks on them are described in [Java records](https://jubasse.github.io/seampact/types-and-validation/java-records/); see [Types and validation](https://jubasse.github.io/seampact/types-and-validation/).

The plugin adds `io.github.jubasse:seampact-spring-runtime` at its own version: the generated code imports its boundary runtime from there. `./gradlew build` generates the code, then compiles it with yours. The build runs `check` too (`./gradlew seampactCheck` alone). Whether to commit the generated code: [Generated files](https://jubasse.github.io/seampact/configuration/config-file/#generated-files); the other commands: [Commands per stack](https://jubasse.github.io/seampact/features/commands-per-stack/).

The Node CLI does not generate a Spring Boot entry: `seampact generate` refuses it with `config.target.native`.

### With Maven

Add the runtime and the plugin to `pom.xml`, next to `seampact-hooks`, at the same version. Set it once in `<properties>`: `<seampact.version>1.1.0</seampact.version>`.

```xml
<dependency>
  <groupId>io.github.jubasse</groupId>
  <artifactId>seampact-spring-runtime</artifactId>
  <version>${seampact.version}</version>
</dependency>
```

```xml
<plugin>
  <groupId>io.github.jubasse</groupId>
  <artifactId>seampact-maven-plugin</artifactId>
  <version>${seampact.version}</version>
  <executions>
    <execution>
      <goals>
        <goal>generate</goal>
        <goal>check</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

`./mvnw verify` generates the code before it compiles, then checks it. When nothing changed since the last run, `generate` skips.

You can write the config in `<configuration>` instead of `seampact.config.yaml`, with the same keys. A list holds one child per item. Keep one of the two: a project with both fails.

```xml
<configuration>
  <outDir>target/generated-sources/seampact</outDir>
  <targets>
    <target>
      <id>notes</id>
      <use>io.github.jubasse:seampact-spring-boot</use>
      <api>notes</api>
      <options><package>com.example.notes.api</package></options>
    </target>
  </targets>
</configuration>
```

### The runtime must match the plugin

Before it writes, `generate` reads the runtime on the compile classpath, with Gradle as with Maven. It fails with `runtime.missing` when there is none. It fails with `runtime.version-mismatch` when the runtime is another `major.minor`, or an older patch, than the plugin. A later patch passes.

## Wire it in

The plugin generates a configuration class, `NotesSeampactConfiguration`, in `<package>.spring`. Spring finds it by component scan when `package` sits under your application's package. Otherwise import it:

```java
@SpringBootApplication
@Import(NotesSeampactConfiguration.class)
class NotesApplication {
}
```

Your controller and hook beans are found as usual. Your own routes stay beside the contract's. To serve the api under a prefix inside the app, set `mount: /api` on the target entry (see [Deploy](https://jubasse.github.io/seampact/backend/spring-boot/#deploy)).
