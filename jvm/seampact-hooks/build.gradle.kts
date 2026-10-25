// seampact-hooks (ADR 0010): the access hook interfaces and runtime types generated Java imports, plain Java with
// no runtime dependency (ADR 0009 rule 3), so an application never pulls the Kotlin standard library through it.

plugins {
    `java-library`
}

group = "io.github.jubasse"

apply(from = rootProject.file("gradle/publication.gradle.kts"))

// The lowest Java version A13 supports: the bytecode every consumer runs.
val bytecodeJavaVersion = 21

// `-PtestJdk=<major>` runs the tests on that JDK (CI passes 21 and 25); without it they run on the build JDK.
val testJdk: String? = providers.gradleProperty("testJdk").orNull

val repositoryRoot = rootProject.projectDir.parentFile

dependencies {
    // Test only: reads the shared shape manifest; never on the runtime classpath.
    testImplementation(libs.kotlinx.serialization.json)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.withType<JavaCompile>().configureEach {
    options.release = bytecodeJavaVersion
    // `-parameters` keeps the hook parameter names the shape test compares with the manifest.
    options.compilerArgs.addAll(listOf("-parameters", "-Xlint:all", "-Werror"))
}

val runtimeDependencies: Provider<List<String>> =
    configurations.runtimeClasspath.flatMap { classpath ->
        classpath.incoming.resolutionResult.rootComponent.map { root ->
            root.dependencies.map { dependency -> dependency.requested.displayName }
        }
    }

val verifyNoRuntimeDependency by tasks.registering {
    description = "Fails when seampact-hooks has a runtime dependency, naming its coordinates."
    group = LifecycleBasePlugin.VERIFICATION_GROUP
    inputs.property("runtimeDependencies", runtimeDependencies)
    doLast {
        val found = runtimeDependencies.get()
        if (found.isNotEmpty()) {
            throw GradleException(
                "seampact-hooks must have no runtime dependency (ADR 0009 rule 3); remove: ${found.joinToString()}",
            )
        }
    }
}

tasks.check {
    dependsOn(verifyNoRuntimeDependency)
}

val mainClassesDirectory = sourceSets.main.map { it.java.destinationDirectory.get().asFile.absolutePath }

tasks.test {
    useJUnitPlatform()
    systemProperty("seampact.repositoryRoot", repositoryRoot.absolutePath)
    systemProperty("seampact.hooksClassesDirectory", mainClassesDirectory.get())
    // The shape test reads the shared manifest; declared so a change reruns it.
    inputs.dir(repositoryRoot.resolve("fixtures/hooks-shape"))
    if (testJdk != null) {
        javaLauncher = javaToolchains.launcherFor {
            languageVersion = JavaLanguageVersion.of(testJdk)
        }
    }
}
