// seampact-gradle-plugin (ADR 0010, ADR 0011): the Gradle plugin `io.github.jubasse.seampact`. It reads the app config
// from `seampact.config.yaml` or the `seampact { }` DSL, gets each api's IR from a pinned bundle or the pinned
// compiler binary, and generates the spring-boot target into the main Java sources.

import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinVersion

plugins {
    `java-gradle-plugin`
    alias(libs.plugins.kotlin.jvm)
}

group = "io.github.jubasse"

apply(from = rootProject.file("gradle/publication.gradle.kts"))

// The lowest Java version A13 supports: the bytecode every consumer runs.
val bytecodeJavaVersion = 21

// `-PtestJdk=<major>` runs the tests on that JDK (CI passes 21 and 25); without it they run on the build JDK.
val testJdk: String? = providers.gradleProperty("testJdk").orNull

// `-PtestGradle=<version>` runs the TestKit builds on that Gradle release (CI passes the 8.14 floor); without it they
// run on this build's Gradle.
val testGradle: String? = providers.gradleProperty("testGradle").orNull

val repositoryRoot = rootProject.projectDir.parentFile

// The jars the TestKit sample app compiles against besides Spring Boot: seampact-hooks, which is not published yet.
val sampleAppClasspath: Configuration by configurations.creating {
    isCanBeConsumed = false
}

dependencies {
    implementation(project(":seampact-runner"))
    implementation(libs.kotlinx.serialization.json)

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
        // Gradle loads the plugin on the Kotlin it embeds; 8.14, the lowest supported, embeds Kotlin 2.0.
        apiVersion = KotlinVersion.KOTLIN_2_0
        languageVersion = KotlinVersion.KOTLIN_2_0
        freeCompilerArgs.add("-Xsuppress-version-warnings")
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release = bytecodeJavaVersion
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
