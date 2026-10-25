// The Spring Boot consumer: its sources, the code the seampact plugin generates from `seampact.config.yaml`, and the
// compiler binary pinned by its hash (`-PseampactBinary`).

import java.security.MessageDigest

plugins {
    java
    id("org.springframework.boot") version "4.1.1"
    id("io.github.jubasse.seampact")
}

java {
    toolchain { languageVersion = JavaLanguageVersion.of(providers.gradleProperty("javaVersion").getOrElse("21")) }
}

repositories { mavenCentral() }

dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:4.1.1"))
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("io.github.jubasse:seampact-hooks")
}

val compilerBinary = file(providers.gradleProperty("seampactBinary").orNull
    ?: error("Pass -PseampactBinary=<path of the seampact compiler binary>."))

seampact {
    binary {
        path = compilerBinary
        sha256 = MessageDigest.getInstance("SHA-256").digest(compilerBinary.readBytes()).joinToString("") { "%02x".format(it) }
    }
}

tasks.bootJar {
    archiveFileName = "consumer.jar"
}
