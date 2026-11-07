package io.github.jubasse.seampact.runner

import io.github.jubasse.seampact.ir.config.AppConfig
import io.github.jubasse.seampact.ir.config.AppConfigEntry
import io.github.jubasse.seampact.ir.config.ConfigProblem
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The compatibility check of the JVM entries (ADR 0011 "The app config"): each outcome for a resolved framework version.
class MatrixCheckTest {
    private val springBoot = JvmFramework("spring-boot", "org.springframework.boot:spring-boot", listOf(4), mapOf(3 to "it runs Spring Framework 6."))
    private val zeroVer = JvmFramework("fastapi", "fastapi", listOf(1), emptyMap())
    private val frameworks = mapOf("spring-boot" to springBoot, "zero" to zeroVer)

    private fun config(use: String = "spring-boot", allowUntested: List<String>? = null, checks: JsonObject? = null): AppConfig {
        val members = mutableMapOf<String, kotlinx.serialization.json.JsonElement>("id" to JsonPrimitive("api"), "use" to JsonPrimitive(use))
        if (allowUntested != null) members["allowUntested"] = JsonArray(allowUntested.map(::JsonPrimitive))
        val entry = AppConfigEntry(JsonObject(members), Path.of("out"))

        return AppConfig("test", Path.of("."), Path.of("out"), null, emptyMap(), listOf(entry), emptyList(), null, checks, null, null)
    }

    private fun codes(problems: List<ConfigProblem>): List<String> = problems.map { it.code }

    @Test
    fun acceptsATestedMajor() {
        val outcome = checkMatrix(config(), "4.1.2", frameworks)

        assertEquals(emptyList(), outcome.problems)
        assertEquals(emptyList(), outcome.warnings)
    }

    @Test
    fun checksNothingWithoutAResolvedVersionOrForATargetTheMatrixDoesNotRecord() {
        assertEquals(MatrixOutcome(emptyList(), emptyList()), checkMatrix(config(), null, frameworks))
        assertEquals(MatrixOutcome(emptyList(), emptyList()), checkMatrix(config(use = "other"), "9.0.0", frameworks))
    }

    @Test
    fun refusesAMajorTheTargetDoesNotWorkOnWithTheMatrixReason() {
        val outcome = checkMatrix(config(), "3.5.1", frameworks)

        assertEquals(
            listOf(
                ConfigProblem(
                    "config.matrix.incompatible",
                    "org.springframework.boot:spring-boot 3.5.1 is on the compile classpath, and the target 'spring-boot' does not work on spring-boot 3: it runs Spring Framework 6.",
                    "Use a major of org.springframework.boot:spring-boot the target is tested on: 4.",
                    "entry 'api'",
                ),
            ),
            outcome.problems,
        )
    }

    @Test
    fun warnsOnAnUntestedMajorAndRefusesItUnderTheErrorLevel() {
        val warned = checkMatrix(config(), "5.0.0", frameworks)
        val refused = checkMatrix(config(checks = JsonObject(mapOf("matrix" to JsonPrimitive("error")))), "5.0.0", frameworks)

        assertEquals(listOf("config.matrix.untested"), codes(warned.warnings))
        assertEquals(emptyList(), warned.problems)
        assertEquals("Use a tested major, or accept this one with `allowUntested: [spring-boot@5]` on the entry.", warned.warnings.single().fix)
        assertEquals(listOf("config.matrix.untested"), codes(refused.problems))
        assertEquals(emptyList(), refused.warnings)
    }

    @Test
    fun acceptsAnUntestedMajorTheEntryAllowsAndNamesAZeroVersionByItsMinor() {
        val allowed = checkMatrix(config(allowUntested = listOf("spring-boot@5")), "5.0.0", frameworks)
        val zeroWarned = checkMatrix(config(use = "zero"), "0.162.1", frameworks)
        val zeroAllowed = checkMatrix(config(use = "zero", allowUntested = listOf("fastapi@0.162")), "0.162.1", frameworks)
        val zeroNoMinor = checkMatrix(config(use = "zero"), "0", frameworks)

        assertEquals(MatrixOutcome(emptyList(), emptyList()), allowed)
        assertTrue(zeroWarned.warnings.single().fix.contains("allowUntested: [fastapi@0.162]"), zeroWarned.warnings.single().fix)
        assertEquals(MatrixOutcome(emptyList(), emptyList()), zeroAllowed)
        assertTrue(zeroNoMinor.warnings.single().fix.contains("allowUntested: [fastapi@0.<minor>]"), zeroNoMinor.warnings.single().fix)
    }

    @Test
    fun refusesAnAllowUntestedItemOfAnotherFrameworkAndWarnsOnOneThatAcceptsNothing() {
        val foreign = checkMatrix(config(allowUntested = listOf("fastapi@1")), "4.0.0", frameworks)
        val redundant = checkMatrix(config(allowUntested = listOf("spring-boot@4")), "4.0.0", frameworks)

        assertEquals(listOf("config.matrix.unknown-framework"), codes(foreign.problems))
        assertEquals("entry 'api' allowUntested", foreign.problems.single().where)
        assertEquals(listOf("config.matrix.allowed-tested"), codes(redundant.warnings))
        assertEquals(emptyList(), redundant.problems)
    }

    @Test
    fun refusesAVersionWhoseMajorCannotBeRead() {
        val outcome = checkMatrix(config(), "snapshot", frameworks)

        assertEquals(listOf("framework.version.unresolved"), codes(outcome.problems))
        assertEquals("Depend on a released org.springframework.boot:spring-boot version, major 4.", outcome.problems.single().fix)
    }

    @Test
    fun readsTheJvmTargetsOfThePackedMatrix() {
        val frameworksOfMatrix = jvmFrameworks()

        val springBootTarget = frameworksOfMatrix.getValue("io.github.jubasse:seampact-spring-boot")
        assertEquals("spring-boot", springBootTarget.id)
        assertEquals(listOf(4), springBootTarget.testedMajors)
        assertTrue(springBootTarget.incompatible.keys.containsAll(listOf(2, 3)))
        assertEquals("4", testedMajorsOf("io.github.jubasse:seampact-spring-boot"))
    }

    @Test
    fun printsOneBlockPerProblemWithItsPlaceWhenThereIsOne() {
        val text = problemsText(listOf(ConfigProblem("a.code", "It broke.", "Mend it.", "entry 'x'"), ConfigProblem("b.code", "Again.", "Retry.")))

        assertEquals("a.code (entry 'x'): It broke.\n    Fix: Mend it.\nb.code: Again.\n    Fix: Retry.", text)
    }
}
