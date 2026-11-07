// seampact-compiler (ADR 0010): the standalone compiler binaries published as Maven artefacts, one per platform
// classifier (`compiler-publication.gradle.kts`). The module has no code; its test publishes stub binaries.

plugins {
    id("seampact.published-module")
    java
}

apply(from = "compiler-publication.gradle.kts")

val publicationScript = file("compiler-publication.gradle.kts")

dependencies {
    testImplementation(project(":seampact-ir"))
    testImplementation(gradleTestKit())
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.withType<JavaCompile>().configureEach {
    options.compilerArgs.addAll(listOf("-Xlint:all", "-Werror"))
}

tasks.test {
    useJUnitPlatform()
    systemProperty("seampact.publicationScript", publicationScript.absolutePath)
    // The test applies the script to a throwaway project; declared so a change reruns it.
    inputs.file(publicationScript)
}
