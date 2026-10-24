// seampact-ir (ADR 0010): the IR model generated from the IR JSON Schema, the native naming, the reader, the
// contract bundle reader, verifier and channels (ADR 0011), the pinned standalone compiler binary, the app config
// reader with each target entry's IR view, and the generated-file writer (ADR 0015).

import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

group = "io.github.jubasse"

// The lowest Java version A13 supports: the bytecode every consumer runs.
val bytecodeJavaVersion = 21

// `-PtestJdk=<major>` runs the tests on that JDK (CI passes 21 and 25); without it they run on the build JDK.
val testJdk: String? = providers.gradleProperty("testJdk").orNull

val repositoryRoot = rootProject.projectDir.parentFile

// The JSON Schemas of `@seampact/spec` this module validates against, copied into the jar beside their readers, so
// each schema stays the one source of its shape: the bundle manifest, the app and root configs, the IR.
val copySpecSchemas = tasks.register<Sync>("copySpecSchemas") {
    val schemas = repositoryRoot.resolve("packages/core/spec/schemas")
    from(schemas.resolve("bundle/manifest.schema.json")) {
        into("io/github/jubasse/seampact/ir/bundle")
    }
    from(schemas.resolve("ir")) {
        include("*.schema.json")
        into("io/github/jubasse/seampact/ir/bundle/ir-schema")
    }
    from(schemas.resolve("config")) {
        include("*.schema.json")
        into("io/github/jubasse/seampact/ir/config")
    }
    into(layout.buildDirectory.dir("generated/spec-schemas"))
}

sourceSets.main {
    resources.srcDir(copySpecSchemas)
}

dependencies {
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.snakeyaml.engine)
    implementation(libs.json.schema.validator)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(kotlin("test"))
    testRuntimeOnly(libs.junit.platform.launcher)
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

tasks.test {
    useJUnitPlatform()
    systemProperty("seampact.repositoryRoot", repositoryRoot.absolutePath)
    // The tests read these shared files; declared so a change reruns them.
    inputs.dir(repositoryRoot.resolve("packages/core/spec/vectors"))
    inputs.dir(repositoryRoot.resolve("packages/core/spec/schemas/ir/examples"))
    inputs.dir(repositoryRoot.resolve("fixtures/golden"))
    inputs.dir(repositoryRoot.resolve("fixtures/reference"))
    inputs.file(repositoryRoot.resolve("packages/tools/binary/scripts/binary-names.mjs"))
    // A build environment may set NODE_OPTIONS: the runner must not pass it on, and the binary must ignore it.
    environment("NODE_OPTIONS", "--require ./seampact-test-no-such-module.cjs")
    // `-PseampactBinary=<path>` runs the binary runner test on that standalone compiler binary.
    val seampactBinary = providers.gradleProperty("seampactBinary").orNull
    if (seampactBinary != null) {
        systemProperty("seampact.binary", seampactBinary)
        inputs.file(seampactBinary)
    }
    if (testJdk != null) {
        javaLauncher = javaToolchains.launcherFor {
            languageVersion = JavaLanguageVersion.of(testJdk)
        }
    }
}
