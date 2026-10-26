// seampact-signed-webhooks (ADR 0013): the optional helper that verifies a template-signed webhook behind the
// authenticate hook, plain Java with no runtime dependency (ADR 0009 rule 3).

plugins {
    id("seampact.library-module")
    `java-library`
}

description = "Verifies template-signed webhooks (HMAC-SHA256) behind the seampact authenticate hook."

val repositoryRoot = rootProject.projectDir.parentFile

dependencies {
    // Test only: reads the shared ADR 0013 vectors; never on the runtime classpath.
    testImplementation(libs.kotlinx.serialization.json)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.withType<JavaCompile>().configureEach {
    options.compilerArgs.addAll(listOf("-Xlint:all", "-Werror"))
}

val runtimeDependencies: Provider<List<String>> =
    configurations.runtimeClasspath.flatMap { classpath ->
        classpath.incoming.resolutionResult.rootComponent.map { root ->
            root.dependencies.map { dependency -> dependency.requested.displayName }
        }
    }

val verifyNoRuntimeDependency by tasks.registering {
    description = "Fails when seampact-signed-webhooks has a runtime dependency, naming its coordinates."
    group = LifecycleBasePlugin.VERIFICATION_GROUP
    inputs.property("runtimeDependencies", runtimeDependencies)
    doLast {
        val found = runtimeDependencies.get()
        if (found.isNotEmpty()) {
            throw GradleException(
                "seampact-signed-webhooks must have no runtime dependency (ADR 0009 rule 3); remove: ${found.joinToString()}",
            )
        }
    }
}

tasks.check {
    dependsOn(verifyNoRuntimeDependency)
}

tasks.test {
    useJUnitPlatform()
    systemProperty("seampact.repositoryRoot", repositoryRoot.absolutePath)
    // The vectors are shared with the npm and Composer helpers; declared so a change reruns the test.
    inputs.dir(repositoryRoot.resolve("packages/runtime/signed-webhooks/vectors"))
}
