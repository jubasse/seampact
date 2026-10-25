// seampact-ir (ADR 0010): the IR model generated from the IR JSON Schema, the native naming, the reader, the
// contract bundle reader, verifier and channels (ADR 0011), the pinned standalone compiler binary, the app config
// reader with each target entry's IR view, and the generated-file writer (ADR 0015).

import org.jetbrains.kotlin.gradle.dsl.KotlinVersion

plugins {
    id("seampact.library-module")
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

description = "The seampact IR model and reader, the contract bundle channels, the pinned compiler binary and the app config reader."

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
        allWarningsAsErrors = true
        // The Gradle plugin loads this module on the Kotlin its lowest supported Gradle embeds (8.14: Kotlin 2.0).
        apiVersion = KotlinVersion.KOTLIN_2_0
        languageVersion = KotlinVersion.KOTLIN_2_0
        freeCompilerArgs.add("-Xsuppress-version-warnings")
    }
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
    // Nor any other variable outside the binary's contract, such as an OpenSSL configuration.
    environment("OPENSSL_CONF", "./seampact-test-no-such-openssl.cnf")
    // The binary cache refuses a directory others may write above it, such as /tmp: the tests' temporary files
    // live under build/ instead.
    val testTemporaryDirectory = layout.buildDirectory.dir("tmp/test-temporary").get().asFile
    systemProperty("java.io.tmpdir", testTemporaryDirectory.absolutePath)
    doFirst { testTemporaryDirectory.mkdirs() }
    // `-PseampactBinary=<path>` runs the binary runner test on that standalone compiler binary.
    val seampactBinary = providers.gradleProperty("seampactBinary").orNull
    if (seampactBinary != null) {
        systemProperty("seampact.binary", seampactBinary)
        inputs.file(seampactBinary)
    }
}
