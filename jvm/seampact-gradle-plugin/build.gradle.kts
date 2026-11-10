// seampact-gradle-plugin (ADR 0010, ADR 0011): the Gradle plugin `io.github.jubasse.seampact`. It reads the app config
// from `seampact.config.yaml` or the `seampact { }` DSL, gets each api's IR from a pinned bundle or the pinned
// compiler binary, and generates the spring-boot target into the main Java sources.

import io.github.jubasse.seampact.conventions.PublishedModulePlugin
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.testing.logging.TestExceptionFormat
import org.jetbrains.kotlin.gradle.dsl.KotlinVersion

plugins {
    id("seampact.published-module")
    `java-gradle-plugin`
    alias(libs.plugins.kotlin.jvm)
    // The release publishes the plugin to the Gradle Plugin Portal with `publishPlugins`.
    alias(libs.plugins.gradle.plugin.publish)
}

description = "Seampact for Spring Boot: generates the Java code of a YAML API contract when you build, with request and reply checks around your controllers."

// `-PtestGradle=<version>` runs the TestKit builds on that Gradle release (CI passes the 8.14 floor); without it they
// run on this build's Gradle.
val testGradle: String? = providers.gradleProperty("testGradle").orNull

val repositoryRoot = rootProject.projectDir.parentFile

// The jars the TestKit sample app compiles against besides Spring Boot: seampact-hooks, which is not published yet.
val sampleAppClasspath: Configuration = configurations.create("sampleAppClasspath") {
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
    testImplementation(testFixtures(project(":seampact-runner")))
    testRuntimeOnly(libs.junit.platform.launcher)
}

gradlePlugin {
    website = "https://jubasse.github.io/seampact/backend/spring-boot/"
    vcsUrl = "https://github.com/jubasse/seampact"
    plugins {
        create("seampact") {
            id = "io.github.jubasse.seampact"
            implementationClass = "io.github.jubasse.seampact.gradle.SeampactPlugin"
            displayName = "seampact Spring Boot"
            description = "Seampact for Spring Boot: generates the Java code of a YAML API contract when you build, with request and reply checks around your controllers."
            tags = listOf("seampact", "api-contract", "codegen", "spring-boot", "openapi", "java")
        }
    }
}

kotlin {
    explicitApi()
    compilerOptions {
        allWarningsAsErrors = true
        // Gradle loads the plugin on the Kotlin it embeds; 8.14, the lowest supported, embeds Kotlin 2.0.
        apiVersion = KotlinVersion.KOTLIN_2_0
        languageVersion = KotlinVersion.KOTLIN_2_0
        freeCompilerArgs.add("-Xsuppress-version-warnings")
    }
}

// The modules a TestKit build resolves from the root build's file repository: the runtime the plugin adds.
val publishedModules = listOf(":seampact-hooks", ":seampact-spring-runtime")

tasks.test {
    useJUnitPlatform()
    // A failed GradleRunner build throws with the build's whole output in its message, which the full format prints.
    testLogging.exceptionFormat = TestExceptionFormat.FULL
    dependsOn(publishedModules.map { "$it:publishAllPublicationsToTestRepository" })
    systemProperty("seampact.testRepository", rootProject.layout.buildDirectory.dir("test-repository").get().asFile.absolutePath)
    systemProperty("seampact.repositoryRoot", repositoryRoot.absolutePath)
    // The TestKit builds share one Gradle user home under build/, so Spring Boot is downloaded once per clean build.
    systemProperty("seampact.testKitDirectory", layout.buildDirectory.dir("testkit").get().asFile.absolutePath)
    systemProperty("seampact.springBootVersion", libs.versions.spring.boot.get())
    if (testGradle != null) systemProperty("seampact.testGradle", testGradle)
    // A local copy: the provider must not capture the script, which the configuration cache cannot store.
    val sampleAppFiles: FileCollection = sampleAppClasspath
    inputs.files(sampleAppFiles)
    jvmArgumentProviders.add(CommandLineArgumentProvider { listOf("-Dseampact.sampleAppClasspath=${sampleAppFiles.asPath}") })
    inputs.file(repositoryRoot.resolve("packages/core/spec/schemas/config/app.schema.json"))
    inputs.dir(repositoryRoot.resolve("fixtures/golden/reference"))
    inputs.dir(repositoryRoot.resolve("fixtures/reference"))
    PublishedModulePlugin.declareTestRepositoryInputs(this, publishedModules)
    // The bundle a test publishes to its own repository.
    inputs.file(repositoryRoot.resolve("packages/core/spec/vectors/bundle/vectors.json"))
    // The TestKit builds copy its repository retry settings.
    inputs.file(rootProject.file("gradle.properties")).withPropertyName("jvmGradleProperties").withPathSensitivity(PathSensitivity.NONE)
    // The TestKit builds inherit the environment, and the Maven builds it starts read MAVEN_ARGS.
    inputs.property("mavenArgs", providers.environmentVariable("MAVEN_ARGS").orElse(""))
}
