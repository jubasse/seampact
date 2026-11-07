package io.github.jubasse.seampact.ir.bundle

import io.github.jubasse.seampact.ir.config.LocalSourcePolicy
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.assertEquals
import kotlin.test.assertIs
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir

// The git channel against a local repository holding the valid bundle under a tag: the fetch, local sources
// refused, and the refusals of `fetch-git.ts`.
class GitFetchTest {
    @TempDir
    lateinit var workspace: Path

    private lateinit var repository: Path

    @BeforeEach
    fun createRepository() {
        repository = Files.createDirectories(workspace.resolve("contract"))
        BundleFixture.writeInto(Files.createDirectories(repository.resolve("dist/bundle")))
        Files.writeString(repository.resolve("README.md"), "The contract.\n")

        git("init", "--quiet")
        git("add", "--all")
        git("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "Bundle.")
        git("tag", "v1")
    }

    @Test
    fun fetchesTheBundleDirectoryOfATag() {
        val verified = fetch(source(), LocalSourcePolicy.ALLOW)

        assertIs<BundleVerifyResult.Verified>(verified)
    }

    @Test
    fun refusesALocalRepositoryWhenLocalSourcesAreRefused() {
        assertEquals(listOf("bundle.source-local"), codes(fetch(source(), LocalSourcePolicy.REFUSE)))
    }

    @Test
    fun refusesWhatTheNodeRunnerRefuses() {
        assertEquals(listOf("bundle.git-url"), codes(fetch(source().copy(url = "git://example.com/contract"), LocalSourcePolicy.ALLOW)))
        val marker = workspace.resolve("ext-ran")
        assertEquals(listOf("bundle.git-failed"), codes(fetch(source().copy(url = "ext::sh -c touch% $marker"), LocalSourcePolicy.ALLOW)))
        assertEquals(false, Files.exists(marker), "git's ext transport is never run")
        assertEquals(listOf("bundle.git-tag"), codes(fetch(source().copy(tag = "--upload-pack=x"), LocalSourcePolicy.ALLOW)))
        assertEquals(listOf("bundle.git-directory"), codes(fetch(source().copy(directory = "../outside"), LocalSourcePolicy.ALLOW)))
        assertEquals(listOf("bundle.git-failed"), codes(fetch(source().copy(tag = "v2"), LocalSourcePolicy.ALLOW)))
        assertEquals(listOf("bundle.archive-entry-path"), codes(fetch(source().copy(directory = null), LocalSourcePolicy.ALLOW)))
    }

    private fun source() = BundleSource.Git(repository.toString(), "v1", "dist/bundle", BundleFixture.integrity)

    private fun fetch(source: BundleSource.Git, policy: LocalSourcePolicy): BundleVerifyResult =
        BundleFetcher(workspace.resolve("cache"), System.getenv(), { error("no Maven artefact in this test") }).fetch(source, workspace, policy)

    private fun codes(result: BundleVerifyResult): List<String> = assertIs<BundleVerifyResult.Refused>(result).failures.map { it.code.code }

    private fun git(vararg arguments: String) {
        val process = ProcessBuilder(listOf("git") + arguments).directory(repository.toFile()).redirectErrorStream(true).start()
        val output = process.inputStream.readAllBytes().toString(Charsets.UTF_8)
        check(process.waitFor() == 0) { "git ${arguments.joinToString(" ")} failed: $output" }
    }
}
