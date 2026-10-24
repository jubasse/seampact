package io.github.jubasse.seampact.gradle

import org.gradle.testfixtures.ProjectBuilder
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.createDirectories
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// A `maven` bundle Gradle downloaded from a remote repository lies in one of its module caches and is not local;
// one Gradle used in place from `mavenLocal()` or a `file:` repository is (ADR 0011).
class BundleOriginTest {
    @TempDir
    lateinit var directory: Path

    private val coordinates = "com.example:contract:1.0.0"

    private fun bundleAt(parent: Path): Path {
        val file = parent.createDirectories().resolve("contract-1.0.0.tgz")
        Files.write(file, byteArrayOf(1))

        return file
    }

    @Test
    fun aBundleInAGradleModuleCacheIsRemoteAndAnyOtherIsLocal() {
        val userHomeCache = directory.resolve("gradle-home/caches/modules-2")
        val readOnlyCache = directory.resolve("read-only/modules-2")
        val roots = listOf(userHomeCache, readOnlyCache)
        val remote = bundleAt(userHomeCache.resolve("files-2.1/com.example/contract/1.0.0/0a1b"))
        val readOnly = bundleAt(readOnlyCache.resolve("files-2.1/com.example/contract/1.0.0/0a1b"))
        val local = bundleAt(directory.resolve("m2/repository/com/example/contract/1.0.0"))
        val project = ProjectBuilder.builder().withProjectDir(directory.toFile()).build()

        assertFalse(GradleBundleArtefacts(project.files(remote), roots).resolve(coordinates).fromLocalRepository)
        assertFalse(GradleBundleArtefacts(project.files(readOnly), roots).resolve(coordinates).fromLocalRepository)
        assertTrue(GradleBundleArtefacts(project.files(local), roots).resolve(coordinates).fromLocalRepository)
        assertEquals(listOf("contract-1.0.0.tgz local", "contract-1.0.0.tgz remote"), bundleOrigins(setOf(remote, local), roots))
    }
}
