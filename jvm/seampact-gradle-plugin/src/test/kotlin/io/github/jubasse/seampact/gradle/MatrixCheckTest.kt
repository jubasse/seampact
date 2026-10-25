package io.github.jubasse.seampact.gradle

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// The compatibility check on the Spring Boot version of the compile classpath (ADR 0011 `checks.matrix`,
// `allowUntested`): an untested major is a warning, an error under `checks.matrix: error` and silent once the entry
// accepts it; an incompatible major is refused. The versions come from a pom-only module of a file repository, as
// only the resolved graph is read.
class MatrixCheckTest {
    @TempDir
    lateinit var directory: Path

    @Test
    fun warnsOnAnUntestedMajor() {
        val app = appOn(UNTESTED_VERSION, SampleApp.REFERENCE_CONFIG)

        val generated = app.run("seampactGenerate")

        assertTrue("config.matrix.untested" in generated.output, generated.output)
        assertTrue("allowUntested: [spring-boot@5]" in generated.output, generated.output)
    }

    @Test
    fun acceptsAnUntestedMajorTheEntryAllows() {
        val app = appOn(UNTESTED_VERSION, SampleApp.REFERENCE_CONFIG.replace(PACKAGE_OPTION, "$PACKAGE_OPTION\n            allowUntested: [spring-boot@5]"))

        val generated = app.run("seampactGenerate")

        assertFalse("config.matrix" in generated.output, generated.output)
    }

    @Test
    fun refusesAnUntestedMajorUnderMatrixError() {
        val app = appOn(UNTESTED_VERSION, SampleApp.REFERENCE_CONFIG.replace(OPENAPI_NONE, "$OPENAPI_NONE\n        checks: { matrix: error }"))

        val refused = app.fail("seampactGenerate")

        assertTrue("config.matrix.untested" in refused.output, refused.output)
    }

    @Test
    fun refusesAnIncompatibleMajorEvenWhenAllowed() {
        val app = appOn(INCOMPATIBLE_VERSION, SampleApp.REFERENCE_CONFIG.replace(PACKAGE_OPTION, "$PACKAGE_OPTION\n            allowUntested: [spring-boot@3]"))

        val refused = app.fail("seampactGenerate")

        assertTrue("config.matrix.incompatible" in refused.output, refused.output)
    }

    // The app with Spring Boot pinned strictly to [springBootVersion], served by a pom-only module.
    private fun appOn(springBootVersion: String, config: String): SampleApp {
        val app = SampleApp(directory)
        app.write(
            "fake-repo/org/springframework/boot/spring-boot/$springBootVersion/spring-boot-$springBootVersion.pom",
            """
            <project xmlns="http://maven.apache.org/POM/4.0.0">
              <modelVersion>4.0.0</modelVersion>
              <groupId>org.springframework.boot</groupId>
              <artifactId>spring-boot</artifactId>
              <version>$springBootVersion</version>
              <packaging>pom</packaging>
            </project>
            """,
        )
        app.write("seampact.config.yaml", config)
        app.writeBuildScript(
            "repositories { maven { url = uri(\"fake-repo\") } }\nseampact {\n${app.stubBinaryBlock()}\n}",
            "implementation(\"org.springframework.boot:spring-boot\") { version { strictly(\"$springBootVersion\") } }",
        )

        return app
    }

    private companion object {
        const val PACKAGE_OPTION = "options: { package: com.example.tasks.api }"
        const val OPENAPI_NONE = "openapi: none"
        const val UNTESTED_VERSION = "5.0.0"
        const val INCOMPATIBLE_VERSION = "3.5.0"
    }
}
