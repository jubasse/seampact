// seampact-ir (ADR 0010): the IR model generated from the IR JSON Schema, the native naming and the reader.

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

dependencies {
    implementation(libs.kotlinx.serialization.json)

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
    if (testJdk != null) {
        javaLauncher = javaToolchains.launcherFor {
            languageVersion = JavaLanguageVersion.of(testJdk)
        }
    }
}
