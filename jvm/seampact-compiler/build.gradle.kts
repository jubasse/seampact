// seampact-compiler (ADR 0010): the standalone compiler binaries published as Maven artefacts, one per platform
// classifier (`compiler-publication.gradle.kts`). The module has no code; its test publishes stub binaries.

plugins {
    java
}

group = "io.github.jubasse"

apply(from = "compiler-publication.gradle.kts")

// The lowest Java version A13 supports: the bytecode every consumer runs.
val bytecodeJavaVersion = 21

// `-PtestJdk=<major>` runs the tests on that JDK (CI passes 21 and 25); without it they run on the build JDK.
val testJdk: String? = providers.gradleProperty("testJdk").orNull

val publicationScript = file("compiler-publication.gradle.kts")

dependencies {
    testImplementation(project(":seampact-ir"))
    testImplementation(gradleTestKit())
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.withType<JavaCompile>().configureEach {
    options.release = bytecodeJavaVersion
    options.compilerArgs.addAll(listOf("-Xlint:all", "-Werror"))
}

tasks.test {
    useJUnitPlatform()
    systemProperty("seampact.publicationScript", publicationScript.absolutePath)
    // The test applies the script to a throwaway project; declared so a change reruns it.
    inputs.file(publicationScript)
    if (testJdk != null) {
        javaLauncher = javaToolchains.launcherFor {
            languageVersion = JavaLanguageVersion.of(testJdk)
        }
    }
}
