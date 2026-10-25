package io.github.jubasse.seampact.maven

import java.nio.file.Path
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import org.junit.jupiter.api.io.TempDir

// The generate stamp sees a new build of the plugin's code that keeps the same coordinates.
class GenerateStampTest {
    @TempDir
    lateinit var directory: Path

    @Test
    fun aRebuiltUnpublishedJarChangesTheInputsHash() {
        val generatorJar = directory.resolve("seampact-spring-boot-0.0.0.jar")

        generatorJar.writeText("generator, first build")
        val firstHash = codeHash(GenerateStamp.CodeArtefact("io.github.jubasse:seampact-spring-boot:0.0.0", false, generatorJar))

        generatorJar.writeText("generator, second build")
        val secondHash = codeHash(GenerateStamp.CodeArtefact("io.github.jubasse:seampact-spring-boot:0.0.0", false, generatorJar))

        assertNotEquals(firstHash, secondHash)
    }

    @Test
    fun aRebuiltSnapshotJarChangesTheInputsHash() {
        val generatorJar = directory.resolve("seampact-spring-boot-1.2.0-SNAPSHOT.jar")

        generatorJar.writeText("generator, first build")
        val firstHash = codeHash(GenerateStamp.CodeArtefact("io.github.jubasse:seampact-spring-boot:1.2.0-SNAPSHOT", true, generatorJar))

        generatorJar.writeText("generator, second build")
        val secondHash = codeHash(GenerateStamp.CodeArtefact("io.github.jubasse:seampact-spring-boot:1.2.0-SNAPSHOT", true, generatorJar))

        assertNotEquals(firstHash, secondHash)
    }

    @Test
    fun aReleasedJarCountsByItsCoordinates() {
        val releasedJar = directory.resolve("seampact-spring-boot-1.2.0.jar")
        releasedJar.writeText("generator 1.2.0")

        val read = codeHash(GenerateStamp.CodeArtefact("io.github.jubasse:seampact-spring-boot:1.2.0", false, releasedJar))
        val notRead = codeHash(GenerateStamp.CodeArtefact("io.github.jubasse:seampact-spring-boot:1.2.0", false, directory.resolve("absent.jar")))
        val otherVersion = codeHash(GenerateStamp.CodeArtefact("io.github.jubasse:seampact-spring-boot:1.2.1", false, releasedJar))

        assertEquals(read, notRead)
        assertNotEquals(read, otherVersion)
    }

    private fun codeHash(artefact: GenerateStamp.CodeArtefact): String {
        val inputs = GenerateStamp.Inputs()
        inputs.code("code", listOf(artefact))

        return inputs.hash()
    }
}
