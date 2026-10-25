// seampact-maven-plugin (ADR 0010, ADR 0011): the Maven plugin `io.github.jubasse:seampact-maven-plugin`. Its goal
// `generate` reads the app config from `seampact.config.yaml` or the plugin's `<configuration>`, gets each api's IR
// from a pinned bundle or the pinned compiler binary, and generates the spring-boot target into the compile sources;
// `check` runs the pinned-bundle check and the generated drift. Built here (lead call 6), so `jvm/` keeps one build
// tool.

import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.maven.plugin.development)
}

group = "io.github.jubasse"
description = "Generates the Spring Boot code of a seampact contract from a pinned bundle or the pinned compiler."

apply(from = rootProject.file("gradle/publication.gradle.kts"))

// The lowest Java version A13 supports: the bytecode every consumer runs.
val bytecodeJavaVersion = 21

// `-PtestJdk=<major>` runs the tests on that JDK (CI passes 21 and 25); without it they run on the build JDK.
val testJdk: String? = providers.gradleProperty("testJdk").orNull

// `-PtestMaven=<version>` runs the Maven builds of the tests on that Maven release (CI passes 3.9 and 4); without it
// they run on the 3.9 floor.
val testMaven: String = providers.gradleProperty("testMaven").getOrElse(libs.versions.apache.maven.get())

val repositoryRoot = rootProject.projectDir.parentFile

// The Gradle plugin's classpath, for the test that generates the same app with both plugins.
val gradlePluginClasspath: Configuration = configurations.create("gradlePluginClasspath") {
    isCanBeConsumed = false
}

dependencies {
    implementation(project(":seampact-runner"))
    implementation(libs.kotlinx.serialization.json)

    // Provided by Maven at run time.
    compileOnly(libs.maven.plugin.api)
    compileOnly(libs.maven.core)
    compileOnly(libs.maven.plugin.annotations)
    compileOnly(libs.javax.inject)

    gradlePluginClasspath(project(":seampact-gradle-plugin"))

    testImplementation(libs.maven.core)
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(kotlin("test"))
    testImplementation(gradleTestKit())
    testRuntimeOnly(libs.junit.platform.launcher)
}

mavenPlugin {
    goalPrefix = "seampact"
}

// The mojos are Kotlin: the descriptor is read from the Kotlin classes too, not only the Java ones.
tasks.generateMavenPluginDescriptor {
    classesDirs.from(tasks.compileKotlin.flatMap { it.destinationDirectory })
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

// The modules a test's Maven build resolves, published to the root build's file repository.
val publishedModules = listOf(":seampact-ir", ":seampact-hooks", ":seampact-spring-boot", ":seampact-runner", ":seampact-maven-plugin")

tasks.test {
    useJUnitPlatform()
    dependsOn(publishedModules.map { "$it:publishAllPublicationsToTestRepository" })
    systemProperty("seampact.repositoryRoot", repositoryRoot.absolutePath)
    systemProperty("seampact.testRepository", rootProject.layout.buildDirectory.dir("test-repository").get().asFile.absolutePath)
    systemProperty("seampact.testWorkDirectory", layout.buildDirectory.dir("maven-test").get().asFile.absolutePath)
    systemProperty("seampact.testKitDirectory", layout.buildDirectory.dir("testkit").get().asFile.absolutePath)
    systemProperty("seampact.pluginVersion", project.version.toString())
    systemProperty("seampact.springBootVersion", libs.versions.spring.boot.get())
    systemProperty("seampact.testMaven", testMaven)
    inputs.property("testMaven", testMaven)
    inputs.files(gradlePluginClasspath)
    jvmArgumentProviders.add(CommandLineArgumentProvider { listOf("-Dseampact.gradlePluginClasspath=${gradlePluginClasspath.asPath}") })
    inputs.file(repositoryRoot.resolve("packages/core/spec/schemas/config/app.schema.json"))
    inputs.dir(repositoryRoot.resolve("fixtures/golden/reference"))
    inputs.dir(repositoryRoot.resolve("fixtures/reference"))
    inputs.dir(repositoryRoot.resolve("scripts/consumers/targets/spring-boot/maven"))
    inputs.dir(rootProject.file("seampact-spring-boot/src/test/golden"))
    if (testJdk != null) {
        javaLauncher = javaToolchains.launcherFor {
            languageVersion = JavaLanguageVersion.of(testJdk)
        }
    }
}
