// seampact-spring-boot (ADR 0022): the Spring Boot server target, a pure generator both build plugins call. Its
// golden tree is compiled by javac of the test JDK against Spring Boot 4, then its records' redaction is checked.

import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinVersion

plugins {
    alias(libs.plugins.kotlin.jvm)
}

group = "io.github.jubasse"

// The lowest Java version A13 supports: the bytecode every consumer runs, and the release the golden tree targets.
val bytecodeJavaVersion = 21

// `-PtestJdk=<major>` runs the tests and compiles the golden tree on that JDK (CI passes 21 and 25).
val testJdk: String? = providers.gradleProperty("testJdk").orNull

// `-PupdateGolden` rewrites the golden tree from the generator instead of comparing with it.
val updateGolden: Boolean = providers.gradleProperty("updateGolden").isPresent

val repositoryRoot = rootProject.projectDir.parentFile

val goldenDirectory = layout.projectDirectory.dir("src/test/golden")

dependencies {
    api(project(":seampact-ir"))
    implementation(libs.javapoet)
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
        // The Gradle plugin loads this module on the Kotlin its lowest supported Gradle embeds (8.14: Kotlin 2.0).
        apiVersion = KotlinVersion.KOTLIN_2_0
        languageVersion = KotlinVersion.KOTLIN_2_0
        freeCompilerArgs.add("-Xsuppress-version-warnings")
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release = bytecodeJavaVersion
}

fun Test.onTestJdk() {
    if (testJdk != null) {
        javaLauncher = javaToolchains.launcherFor {
            languageVersion = JavaLanguageVersion.of(testJdk)
        }
    }
}

tasks.test {
    useJUnitPlatform()
    systemProperty("seampact.repositoryRoot", repositoryRoot.absolutePath)
    systemProperty("seampact.goldenDirectory", goldenDirectory.asFile.absolutePath)
    systemProperty("seampact.updateGolden", updateGolden.toString())
    inputs.dir(repositoryRoot.resolve("fixtures/golden/reference"))
    inputs.dir(goldenDirectory)
    onTestJdk()
}

// The golden tree as an app compiles it: the Spring Boot 4 starters the generated code needs, seampact-hooks, and
// the checks that run the compiled tree: its records' redaction and the boundary runtime on mock requests.
val golden: SourceSet = sourceSets.create("golden") {
    java.srcDir(goldenDirectory)
    java.srcDir("src/goldenCheck/java")
}

dependencies {
    "goldenImplementation"(platform(libs.spring.boot.dependencies))
    "goldenImplementation"(libs.spring.boot.starter.webmvc)
    "goldenImplementation"(libs.spring.boot.starter.validation)
    "goldenImplementation"(project(":seampact-hooks"))
    "goldenImplementation"(libs.spring.test)
    "goldenImplementation"(platform(libs.junit.bom))
    "goldenImplementation"(libs.junit.jupiter)
    "goldenRuntimeOnly"(libs.junit.platform.launcher)
}

tasks.named<JavaCompile>(golden.compileJavaTaskName) {
    // The golden tree is compared first, so a stale tree fails by its diff, not by a compile error.
    mustRunAfter(tasks.test)
    options.compilerArgs.addAll(listOf("-Xlint:all", "-Werror"))
    if (testJdk != null) {
        javaCompiler = javaToolchains.compilerFor {
            languageVersion = JavaLanguageVersion.of(testJdk)
        }
    }
}

val goldenTest = tasks.register<Test>("goldenTest") {
    description = "Compiles the golden tree against Spring Boot 4 on the test JDK and checks its redaction."
    group = LifecycleBasePlugin.VERIFICATION_GROUP
    testClassesDirs = golden.output.classesDirs
    classpath = golden.runtimeClasspath
    useJUnitPlatform()
    shouldRunAfter(tasks.test)
    onTestJdk()
}

tasks.check {
    dependsOn(goldenTest)
}
