package io.github.jubasse.seampact.maven

import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.deleteIfExists
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import org.junit.jupiter.api.io.TempDir

// The generate stamp sees a new build of the plugin's code that keeps the same coordinates, and reads a `path`
// source through its symbolic links as the compiler does.
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

    @Test
    fun aFileEditedBehindASymlinkedDirectoryChangesTheInputsHash() {
        val source = directory.resolve("contract").createDirectories()
        val shared = directory.resolve("shared").createDirectories()
        Files.createSymbolicLink(source.resolve("shared"), shared)

        shared.resolve("types.yaml").writeText("first")
        val firstHash = treesHash(source)

        shared.resolve("types.yaml").writeText("second")
        val secondHash = treesHash(source)

        assertNotEquals(firstHash, secondHash)
    }

    @Test
    fun aRetargetedSymlinkChangesTheInputsHash() {
        val source = directory.resolve("contract").createDirectories()
        source.resolve("v1").createDirectories().resolve("api.yaml").writeText("v1")
        source.resolve("v2").createDirectories().resolve("api.yaml").writeText("v2")
        val current = source.resolve("current")

        Files.createSymbolicLink(current, source.resolve("v1"))
        val firstHash = treesHash(source)

        current.deleteIfExists()
        Files.createSymbolicLink(current, source.resolve("v2"))
        val secondHash = treesHash(source)

        assertNotEquals(firstHash, secondHash)
    }

    @Test
    fun aSymlinkLoopIsHashedOnce() {
        val source = directory.resolve("contract").createDirectories()
        source.resolve("api.yaml").writeText("api")
        Files.createSymbolicLink(source.resolve("loop"), source)

        assertEquals(treesHash(source), treesHash(source))
    }

    private fun treesHash(source: Path): String {
        val inputs = GenerateStamp.Inputs()
        inputs.trees("pathSources", listOf(source))

        return inputs.hash()
    }

    private fun codeHash(artefact: GenerateStamp.CodeArtefact): String {
        val inputs = GenerateStamp.Inputs()
        inputs.code("code", listOf(artefact))

        return inputs.hash()
    }
}
