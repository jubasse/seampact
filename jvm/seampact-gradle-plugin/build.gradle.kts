// seampact-gradle-plugin (ADR 0010, ADR 0011): the Gradle plugin `io.github.jubasse.seampact`. It reads the app config
// from `seampact.config.yaml` or the `seampact { }` DSL, gets each api's IR from a pinned bundle or the pinned
// compiler binary, and generates the spring-boot target into the main Java sources.

import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    `java-gradle-plugin`
    alias(libs.plugins.kotlin.jvm)
}

group = "io.github.jubasse"

// The lowest Java version A13 supports: the bytecode every consumer runs.
val bytecodeJavaVersion = 21

// `-PtestJdk=<major>` runs the tests on that JDK (CI passes 21 and 25); without it they run on the build JDK.
val testJdk: String? = providers.gradleProperty("testJdk").orNull

// `-PtestGradle=<version>` runs the TestKit builds on that Gradle release (CI passes the 8.14 floor); without it they
// run on this build's Gradle.
val testGradle: String? = providers.gradleProperty("testGradle").orNull

// The compiler binaries the plugin pins: `-PseampactBinarySums=<SHA256SUMS>` of the release
// `-PseampactCompilerVersion=<version>`. Without them the jar embeds no pin, and a `path` source needs a `binary { }`
// override.
val binarySums: String? = providers.gradleProperty("seampactBinarySums").orNull
val compilerVersion: String? = providers.gradleProperty("seampactCompilerVersion").orNull

val repositoryRoot = rootProject.projectDir.parentFile

// The pin writer runs at build time on seampact-ir's own `BinaryPins`, so the jar holds the same bytes it reads.
val pins: SourceSet = sourceSets.create("pins")

// The jars the TestKit sample app compiles against besides Spring Boot: seampact-hooks, which is not published yet.
val sampleAppClasspath: Configuration by configurations.creating {
    isCanBeConsumed = false
}

dependencies {
    implementation(project(":seampact-ir"))
    implementation(project(":seampact-spring-boot"))
    implementation(libs.kotlinx.serialization.json)

    "pinsImplementation"(project(":seampact-ir"))
    sampleAppClasspath(project(":seampact-hooks"))

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(kotlin("test"))
    testImplementation(gradleTestKit())
    testRuntimeOnly(libs.junit.platform.launcher)
}

gradlePlugin {
    plugins {
        create("seampact") {
            id = "io.github.jubasse.seampact"
            implementationClass = "io.github.jubasse.seampact.gradle.SeampactPlugin"
            displayName = "seampact"
            description = "Generates the Spring Boot code of a seampact contract from a pinned bundle or the pinned compiler."
        }
    }
}

kotlin {
    explicitApi()
    compilerOptions {
        jvmTarget = JvmTarget.fromTarget(bytecodeJavaVersion.toString())
        freeCompilerArgs.add("-Xjdk-release=$bytecodeJavaVersion")
        allWarningsAsErrors = true
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release = bytecodeJavaVersion
}

val generatedResources = layout.buildDirectory.dir("generated/plugin-resources")

val writeBinaryPins = tasks.register<JavaExec>("writeBinaryPins") {
    description = "Writes seampact-binaries.properties from the release SHA256SUMS the build names."
    classpath = pins.runtimeClasspath
    mainClass = "io.github.jubasse.seampact.gradle.pins.WriteBinaryPinsKt"
    val output = generatedResources.map { it.file("seampact-binaries.properties") }
    outputs.file(output)
    if (binarySums != null) inputs.file(binarySums)
    inputs.property("compilerVersion", compilerVersion ?: "")
    onlyIf("a release SHA256SUMS is named") { binarySums != null }
    argumentProviders.add(CommandLineArgumentProvider { listOf(compilerVersion.orEmpty(), binarySums.orEmpty(), output.get().asFile.absolutePath) })
}

// The plugin version the generated header names.
val writePluginVersion = tasks.register<WriteProperties>("writePluginVersion") {
    destinationFile = generatedResources.map { it.file("io/github/jubasse/seampact/gradle/seampact-plugin.properties") }
    property("version", project.version.toString())
}

sourceSets.main {
    resources.srcDir(files(generatedResources).builtBy(writeBinaryPins, writePluginVersion))
}

tasks.test {
    useJUnitPlatform()
    systemProperty("seampact.repositoryRoot", repositoryRoot.absolutePath)
    // The TestKit builds share one Gradle user home under build/, so Spring Boot is downloaded once per clean build.
    systemProperty("seampact.testKitDirectory", layout.buildDirectory.dir("testkit").get().asFile.absolutePath)
    systemProperty("seampact.springBootVersion", libs.versions.spring.boot.get())
    if (testGradle != null) systemProperty("seampact.testGradle", testGradle)
    inputs.files(sampleAppClasspath)
    jvmArgumentProviders.add(CommandLineArgumentProvider { listOf("-Dseampact.sampleAppClasspath=${sampleAppClasspath.asPath}") })
    inputs.file(repositoryRoot.resolve("packages/core/spec/schemas/config/app.schema.json"))
    inputs.dir(repositoryRoot.resolve("fixtures/golden/reference"))
    inputs.dir(repositoryRoot.resolve("fixtures/reference"))
    if (testJdk != null) {
        javaLauncher = javaToolchains.launcherFor {
            languageVersion = JavaLanguageVersion.of(testJdk)
        }
    }
}
