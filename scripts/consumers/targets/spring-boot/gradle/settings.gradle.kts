// The consumer's Gradle build root (ADR 0022 "The consumer and the proof"): the seampact plugin and seampact-hooks
// come from the repository's JVM build, included by path (`-PseampactJvm`), Spring Boot from the plugin portal and
// Maven Central.

pluginManagement {
    val seampactJvm = providers.gradleProperty("seampactJvm").orNull
        ?: error("Pass -PseampactJvm=<repository>/jvm: the seampact plugin is taken from the repository's JVM build.")
    includeBuild(seampactJvm)
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

rootProject.name = "consumer"

includeBuild(providers.gradleProperty("seampactJvm").get())
