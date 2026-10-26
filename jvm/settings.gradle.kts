// The JVM modules of seampact (ADR 0009, ADR 0010). Test JDKs other than the running one are provisioned
// through the foojay resolver.

// The convention plugins every published module applies.
pluginManagement {
    includeBuild("build-logic")
}

plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

dependencyResolutionManagement {
    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
    repositories {
        mavenCentral()
    }
}

rootProject.name = "seampact-jvm"

include("seampact-ir")
include("seampact-hooks")
include("seampact-signed-webhooks")
include("seampact-compiler")
include("seampact-spring-boot")
include("seampact-runner")
include("seampact-gradle-plugin")
include("seampact-maven-plugin")
