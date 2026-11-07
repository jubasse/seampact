// The convention plugins, written in Java so this build needs no Kotlin DSL plugin. The Kotlin Gradle plugin is
// compile-only: the module that applies Kotlin brings it, at the catalog version.

plugins {
    `java-gradle-plugin`
}

dependencies {
    compileOnly(libs.kotlin.gradle.plugin)
}

tasks.withType<JavaCompile>().configureEach {
    options.compilerArgs.addAll(listOf("-Xlint:all", "-Werror"))
}

gradlePlugin {
    plugins {
        create("publishedModule") {
            id = "seampact.published-module"
            implementationClass = "io.github.jubasse.seampact.conventions.PublishedModulePlugin"
        }
        create("libraryModule") {
            id = "seampact.library-module"
            implementationClass = "io.github.jubasse.seampact.conventions.LibraryModulePlugin"
        }
    }
}
