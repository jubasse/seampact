// Plugins shared by the modules, declared once with their versions from the catalog.

plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    // Beside Kotlin, so the convention plugin sees the Kotlin Gradle plugin it configures.
    id("seampact.published-module") apply false
}
