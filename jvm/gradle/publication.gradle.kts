// The Maven publication of a seampact JVM module (ADR 0011 "Unpublished installs"): `publishToMavenLocal` for the
// test consumers, and the file repository `build/test-repository` of the root build, which the Maven plugin's tests
// read. `-PseampactVersion=<version>` is the release version; without it the modules publish as 0.0.0.

apply(plugin = "maven-publish")

version = providers.gradleProperty("seampactVersion").getOrElse("0.0.0")

configure<PublishingExtension> {
    // `java-gradle-plugin` creates the Gradle plugin's own publications.
    if (!plugins.hasPlugin("java-gradle-plugin")) {
        publications {
            create<MavenPublication>("maven") {
                from(components["java"])
            }
        }
    }
    repositories {
        maven {
            name = "test"
            url = uri(rootProject.layout.buildDirectory.dir("test-repository"))
        }
    }
}
