// seampact-runner (ADR 0010, ADR 0011): the run both JVM build plugins share. It reads the app config, gets each
// api's IR from a pinned bundle or the pinned compiler binary, plans and writes the spring-boot entries, and checks
// the generated files; each plugin adds only its build tool's inputs, resolution and wording.

import org.jetbrains.kotlin.gradle.dsl.KotlinVersion

plugins {
    id("seampact.library-module")
    alias(libs.plugins.kotlin.jvm)
    // The reference app both plugins' tests build.
    `java-test-fixtures`
}

description = "The seampact run both JVM build plugins share: app config, IR, generation and checks."

// The compiler binaries both plugins pin: `-PseampactBinarySums=<SHA256SUMS>` of the release
// `-PseampactCompilerVersion=<version>`. Without them the jar embeds no pin, and a `path` source needs a binary
// override.
val binarySums: String? = providers.gradleProperty("seampactBinarySums").orNull
val compilerVersion: String? = providers.gradleProperty("seampactCompilerVersion").orNull

// The pin writer runs at build time on seampact-ir's own `BinaryPins`, so the jar holds the same bytes it reads.
val pins: SourceSet = sourceSets.create("pins")

dependencies {
    api(project(":seampact-ir"))
    api(project(":seampact-spring-boot"))
    implementation(libs.kotlinx.serialization.json)
    testFixturesImplementation(libs.kotlinx.serialization.json)
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(kotlin("test"))
    testRuntimeOnly(libs.junit.platform.launcher)

    "pinsImplementation"(project(":seampact-ir"))
}

kotlin {
    explicitApi()
    compilerOptions {
        allWarningsAsErrors = true
        // The Gradle plugin loads this module on the Kotlin its lowest supported Gradle embeds (8.14: Kotlin 2.0).
        apiVersion = KotlinVersion.KOTLIN_2_0
        languageVersion = KotlinVersion.KOTLIN_2_0
        freeCompilerArgs.add("-Xsuppress-version-warnings")
    }
}

val generatedResources = layout.buildDirectory.dir("generated/runner-resources")

val writeBinaryPins = tasks.register<JavaExec>("writeBinaryPins") {
    description = "Writes seampact-binaries.properties from the release SHA256SUMS the build names."
    classpath = pins.runtimeClasspath
    mainClass = "io.github.jubasse.seampact.runner.pins.WriteBinaryPinsKt"
    val output = generatedResources.map { it.file("seampact-binaries.properties") }
    outputs.file(output)
    if (binarySums != null) inputs.file(binarySums)
    inputs.property("compilerVersion", compilerVersion ?: "")
    onlyIf("a release SHA256SUMS is named") { binarySums != null }
    argumentProviders.add(CommandLineArgumentProvider { listOf(compilerVersion.orEmpty(), binarySums.orEmpty(), output.get().asFile.absolutePath) })
}

// The version the generated header names: the run's, the same for both plugins.
val writeRunnerVersion = tasks.register<WriteProperties>("writeRunnerVersion") {
    destinationFile = generatedResources.map { it.file("io/github/jubasse/seampact/runner/seampact-runner.properties") }
    property("version", project.version.toString())
}

// The compatibility matrix of `@seampact/spec`, packed into the jar beside its reader, so the matrix keeps one source.
val copyCompatibilityMatrix = tasks.register<Sync>("copyCompatibilityMatrix") {
    val matrixFile = rootProject.projectDir.parentFile.resolve("packages/core/spec/compatibility/matrix.json")
    doFirst { require(matrixFile.exists()) { "The compatibility matrix is missing: $matrixFile" } }
    from(matrixFile) {
        into("io/github/jubasse/seampact/runner")
    }
    into(layout.buildDirectory.dir("generated/compatibility-matrix"))
}

sourceSets.main {
    resources.srcDir(files(generatedResources).builtBy(writeBinaryPins, writeRunnerVersion))
    resources.srcDir(copyCompatibilityMatrix)
}

tasks.test {
    useJUnitPlatform()
}
