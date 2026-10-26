package io.github.jubasse.seampact.ir.binary

import io.github.jubasse.seampact.ir.read.IrSupport
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import java.nio.file.attribute.PosixFilePermissions
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import com.sun.security.auth.module.UnixSystem
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.condition.DisabledOnOs
import org.junit.jupiter.api.condition.OS

// A binary is never started unless its SHA-256 is the pin: a stub executable that writes a marker file proves it.
// The pins read from the release manifest and the embedded properties, and an override without a hash is refused.
class BinaryPinTest {
    private lateinit var work: Path
    private lateinit var marker: Path
    private lateinit var stub: Path

    private val linuxHost = HostPlatform("Linux", "amd64", HostLibc.GLIBC)

    @BeforeTest
    fun writeTheStub() {
        work = Files.createTempDirectory("seampact-binary-pin-")
        marker = work.resolve("started")
        stub = work.resolve("stub")
        Files.writeString(stub, "#!/bin/sh\n/usr/bin/touch '$marker'\nexit 1\n")
        stub.toFile().setExecutable(true)
    }

    @AfterTest
    fun removeTheWork() {
        work.toFile().deleteRecursively()
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun aBinaryWithAnotherHashIsNeverStarted() {
        val wrongPin = BinaryPin.LocalFile(stub, "0".repeat(64))

        val install = install(stub, wrongPin, work.resolve("cache"))

        check(install is BinaryInstall.Refused)
        assertEquals(BinaryFailureCode.HASH_MISMATCH, install.failure.code)
        assertEquals("0".repeat(64), install.failure.expected)
        assertEquals(BinaryInstaller.sha256Of(stub), install.failure.actual)
        assertFalse(Files.exists(marker))
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun aBinaryWithItsHashIsStarted() {
        val pin = BinaryPin.LocalFile(stub, BinaryInstaller.sha256Of(stub))
        val install = install(stub, pin, work.resolve("cache"))
        check(install is BinaryInstall.Installed)
        val config = Files.writeString(work.resolve("seampact.config.yaml"), "targets: []\n")

        val result = BinaryRunner.compile(install.binary, config, IrSupport.ofModel(emptyList()))

        assertTrue(Files.exists(marker))
        assertEquals(1, (result as BinaryCompileResult.Failed).exitCode)
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun anExitOutsideTheContractIsACompileFailure() {
        val result = runStub("exit 3\n")

        val failure = (result as BinaryCompileResult.OutsideContract).failure
        assertEquals(BinaryFailureCode.COMPILE_FAILED, failure.code)
        assertEquals("3", failure.actual)
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun aSignalIsACompileFailureNamingTheSignal() {
        val result = runStub("kill -9 $$\n")

        val failure = (result as BinaryCompileResult.OutsideContract).failure
        assertEquals(BinaryFailureCode.COMPILE_FAILED, failure.code)
        assertTrue(failure.message.contains("signal 9"), failure.message)
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun noIrAfterASuccessIsACompileFailure() {
        val result = runStub("/bin/mkdir \"$5\"\nexit 0\n")

        val failure = (result as BinaryCompileResult.OutsideContract).failure
        assertEquals(BinaryFailureCode.COMPILE_FAILED, failure.code)
        assertTrue(failure.message.contains("without writing an IR file"), failure.message)
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun theDiagnosticsLoseTheirControlCharactersButNewlinesAndTabs() {
        val result = runStub("printf 'bad\\033[2J\\tline\\r\\n' >&2\nexit 1\n")

        assertEquals("bad[2J\tline\n", (result as BinaryCompileResult.Failed).stderr)
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun theBinaryStartsWithOnlyTheContractVariables() {
        // The Gradle test task sets both, as a build environment may.
        assertNotNull(System.getenv("NODE_OPTIONS"), "the test task must set NODE_OPTIONS for this test to prove anything")
        assertNotNull(System.getenv("OPENSSL_CONF"), "the test task must set OPENSSL_CONF for this test to prove anything")

        val result = runStub("/usr/bin/env\nexit 1\n") as BinaryCompileResult.Failed

        val names = result.stdout.lines().filter { it.isNotEmpty() }.map { it.substringBefore("=") }
        assertTrue("OPENSSL_CONF" !in names && "PATH" !in names && names.none { it.uppercase().startsWith("NODE_") }, "$names")
    }

    @Test
    fun onlyTheContractVariablesAreKeptWhateverTheirCase() {
        val environment = mutableMapOf("NODE_OPTIONS" to "--require x", "OPENSSL_CONF" to "/c", "PATH" to "/bin", "TMPDIR" to "/t", "Temp" to "/w", "SystemRoot" to "C:\\Windows")
        val onWindows = environment.toMutableMap()

        BinaryRunner.keepContractVariables(environment, windows = false)
        BinaryRunner.keepContractVariables(onWindows, windows = true)

        assertEquals(mapOf("TMPDIR" to "/t", "Temp" to "/w"), environment)
        assertEquals(mapOf("TMPDIR" to "/t", "Temp" to "/w", "SystemRoot" to "C:\\Windows"), onWindows)
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun aBinaryChangedAfterItsInstallIsNotStarted() {
        val pin = BinaryPin.LocalFile(stub, BinaryInstaller.sha256Of(stub))
        val install = install(stub, pin, work.resolve("cache"))
        check(install is BinaryInstall.Installed)
        Files.writeString(install.binary.path, "#!/bin/sh\n/usr/bin/touch '$marker'\nexit 4\n")
        val config = Files.writeString(work.resolve("seampact.config.yaml"), "targets: []\n")

        val result = BinaryRunner.compile(install.binary, config, IrSupport.ofModel(emptyList()))

        assertEquals(BinaryFailureCode.HASH_MISMATCH, (result as BinaryCompileResult.Refused).failure.code)
        assertFalse(Files.exists(marker))
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun aCacheEntryThatIsALinkIsRefused() {
        val sha256 = BinaryInstaller.sha256Of(stub)
        val entry = Files.createDirectories(work.resolve("cache").resolve(sha256))
        Files.createSymbolicLink(entry.resolve("seampact"), stub)

        val install = install(stub, BinaryPin.LocalFile(stub, sha256), work.resolve("cache"))

        assertEquals(BinaryFailureCode.CACHE_UNSAFE, (install as BinaryInstall.Refused).failure.code)
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun aCacheEntryOtherUsersMayWriteIsRefusedAndANewOneIsOwnerOnly() {
        val sha256 = BinaryInstaller.sha256Of(stub)
        val install = install(stub, BinaryPin.LocalFile(stub, sha256), work.resolve("cache"))
        check(install is BinaryInstall.Installed)
        val entry = install.binary.path.parent
        assertEquals("rwx------", PosixFilePermissions.toString(Files.getPosixFilePermissions(entry)))

        Files.setPosixFilePermissions(entry, PosixFilePermissions.fromString("rwxrwxrwx"))
        val again = install(stub, BinaryPin.LocalFile(stub, sha256), work.resolve("cache"))

        assertEquals(BinaryFailureCode.CACHE_UNSAFE, (again as BinaryInstall.Refused).failure.code)
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun anInstalledBinaryIsOwnerOnlyWhateverTheUmaskAndIsReusedByTheNextBuild() {
        val pin = BinaryPin.LocalFile(stub, BinaryInstaller.sha256Of(stub))

        val first = install(stub, pin, work.resolve("cache"))
        val second = install(stub, pin, work.resolve("cache"))

        check(first is BinaryInstall.Installed)
        assertEquals("rwx------", PosixFilePermissions.toString(Files.getPosixFilePermissions(first.binary.path)))
        assertTrue(second is BinaryInstall.Installed, "$second")
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun theCacheRootAndEachDirectoryTheRunnerCreatesAreOwnerOnlyWhateverTheUmask() {
        val cacheRoot = work.resolve("home").resolve("caches").resolve("binaries")
        val install = install(stub, BinaryPin.LocalFile(stub, BinaryInstaller.sha256Of(stub)), cacheRoot)

        check(install is BinaryInstall.Installed) { "$install" }
        for (directory in listOf(work.resolve("home"), work.resolve("home/caches"), cacheRoot, install.binary.path.parent)) {
            assertEquals("rwx------", PosixFilePermissions.toString(Files.getPosixFilePermissions(directory)), "$directory")
        }
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun aCacheRootOthersMayWriteIsRefusedNamingChmod() {
        val cacheRoot = Files.createDirectory(work.resolve("shared-cache"))
        Files.setPosixFilePermissions(cacheRoot, PosixFilePermissions.fromString("rwxr-xrwx"))

        val install = install(stub, BinaryPin.LocalFile(stub, BinaryInstaller.sha256Of(stub)), cacheRoot)

        val failure = (install as BinaryInstall.Refused).failure
        assertEquals(BinaryFailureCode.CACHE_UNSAFE, failure.code)
        assertTrue(failure.message.contains("chmod 700"), failure.message)
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun aCacheOpenedToOthersAfterTheInstallIsCheckedRightBeforeTheStart() {
        val install = install(stub, BinaryPin.LocalFile(stub, BinaryInstaller.sha256Of(stub)), work.resolve("cache"))
        check(install is BinaryInstall.Installed)
        Files.setPosixFilePermissions(install.binary.path.parent, PosixFilePermissions.fromString("rwxrwxrwx"))
        val config = Files.writeString(work.resolve("seampact.config.yaml"), "targets: []\n")

        val result = BinaryRunner.compile(install.binary, config, IrSupport.ofModel(emptyList()))

        assertEquals(BinaryFailureCode.CACHE_UNSAFE, (result as BinaryCompileResult.Refused).failure.code)
        assertFalse(Files.exists(marker))
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun aDirectoryOthersMayWriteAboveTheCacheIsRefused() {
        val open = Files.createDirectory(work.resolve("open"))
        Files.setPosixFilePermissions(open, PosixFilePermissions.fromString("rwxrwxrwx"))

        val install = install(stub, BinaryPin.LocalFile(stub, BinaryInstaller.sha256Of(stub)), open.resolve("cache"))

        val failure = (install as BinaryInstall.Refused).failure
        assertEquals(BinaryFailureCode.CACHE_UNSAFE, failure.code)
        assertEquals(open.toRealPath().toString(), failure.actual)
    }

    @Test
    fun aRelativeCacheDirectoryIsRefusedNamingItsSetting() {
        val install = install(stub, BinaryPin.LocalFile(stub, BinaryInstaller.sha256Of(stub)), Path.of("relative-cache"))

        val failure = (install as BinaryInstall.Refused).failure
        assertEquals(BinaryFailureCode.CACHE_UNAVAILABLE, failure.code)
        assertTrue(failure.fix.contains(TEST_CACHE_SETTING), failure.fix)
        assertFalse(Files.exists(Path.of("relative-cache")))
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun aLinkOnTheWayToTheCacheIsResolvedOnceAndOnlyTheRealPathIsRun() {
        val privateHome = Files.createDirectory(work.resolve("private-home"))
        val open = Files.createDirectory(work.resolve("open"))
        Files.setPosixFilePermissions(open, PosixFilePermissions.fromString("rwxrwxrwx"))
        val linkedHome = Files.createSymbolicLink(open.resolve("gradle-home"), privateHome)

        val install = install(stub, BinaryPin.LocalFile(stub, BinaryInstaller.sha256Of(stub)), linkedHome.resolve("caches/binaries"))

        check(install is BinaryInstall.Installed) { "$install" }
        assertEquals(privateHome.toRealPath().resolve("caches/binaries"), install.binary.path.parent.parent)
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun aGroupWritableTreeAboveTheCacheIsAcceptedWhenItsGroupIsTheProcessGroup() {
        val project = groupWritableTree(UnixSystem().gid)

        val install = install(stub, BinaryPin.LocalFile(stub, BinaryInstaller.sha256Of(stub)), project.resolve("cache"))

        assertTrue(install is BinaryInstall.Installed, "$install")
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun aGroupWritableDirectoryAboveTheCacheIsRefusedWhenItsGroupIsAnother() {
        val process = UnixSystem()
        val otherGroup = process.groups.firstOrNull { it != process.gid }
        assumeTrue(otherGroup != null, "the user has no supplementary group to give the directory")
        val project = groupWritableTree(otherGroup!!)

        val install = install(stub, BinaryPin.LocalFile(stub, BinaryInstaller.sha256Of(stub)), project.resolve("cache"))

        val failure = (install as BinaryInstall.Refused).failure
        assertEquals(BinaryFailureCode.CACHE_UNSAFE, failure.code)
        assertEquals(project.toRealPath().toString(), failure.actual)
        assertTrue(failure.message.contains("chmod g-w"), failure.message)
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun aCacheRootItsGroupMayWriteIsRefusedNamingChmod700EvenForTheProcessGroup() {
        val cacheRoot = Files.createDirectory(work.resolve("group-cache"))
        Files.setAttribute(cacheRoot, UNIX_GID, UnixSystem().gid.toInt())
        Files.setPosixFilePermissions(cacheRoot, PosixFilePermissions.fromString("rwxrwxr-x"))

        val install = install(stub, BinaryPin.LocalFile(stub, BinaryInstaller.sha256Of(stub)), cacheRoot)

        val failure = (install as BinaryInstall.Refused).failure
        assertEquals(BinaryFailureCode.CACHE_UNSAFE, failure.code)
        assertTrue(failure.message.contains("chmod 700"), failure.message)
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun aChangedSourceIsRefusedEvenWhenTheCacheHoldsThePinnedCopy() {
        val pin = BinaryPin.LocalFile(stub, BinaryInstaller.sha256Of(stub))
        check(install(stub, pin, work.resolve("cache")) is BinaryInstall.Installed)
        Files.writeString(stub, "#!/bin/sh\nexit 5\n")

        val again = install(stub, pin, work.resolve("cache"))

        assertEquals(BinaryFailureCode.HASH_MISMATCH, (again as BinaryInstall.Refused).failure.code)
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun theProfileIsReadByItsRealPath() {
        val profile = Files.createDirectory(work.resolve("profile"))
        val junction = Files.createSymbolicLink(work.resolve("profile-link"), profile)

        assertEquals(profile.toRealPath(), BinaryCache.profileDirectory(junction.toString()))
        assertEquals(null, BinaryCache.profileDirectory(null))
    }

    // Two group-writable directories (umask 002) of group [groupId], the second being the cache root's parent.
    private fun groupWritableTree(groupId: Long): Path {
        val team = Files.createDirectory(work.resolve("team"))
        val project = Files.createDirectory(team.resolve("project"))
        for (directory in listOf(team, project)) {
            Files.setAttribute(directory, UNIX_GID, groupId.toInt())
            Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwxrwxr-x"))
        }

        return project
    }

    private fun install(binary: Path, pin: BinaryPin, cacheRoot: Path): BinaryInstall =
        BinaryInstaller.install(binary, pin, cacheRoot, TEST_CACHE_SETTING)

    private companion object {
        const val TEST_CACHE_SETTING = "the test cache setting"
        const val UNIX_GID = "unix:gid"
    }

    @Test
    fun theManifestGivesThePinsAndTheirPropertiesRoundTrip() {
        val sums = BinaryPlatform.entries.mapIndexed { index, platform -> "${index.toString().repeat(64)}  ${platform.assetName}" }
            .joinToString("\n", postfix = "\n")

        val pins = (BinaryPins.fromSha256Sums("1.2.3", sums) as BinaryPinsRead.Read).pins

        assertEquals("1".repeat(64), pins.sha256ByPlatform.getValue(BinaryPlatform.LINUX_ARM64))
        assertEquals(BinaryPinsRead.Read(pins), BinaryPins.readProperties(pins.toProperties()))
    }

    @Test
    fun aManifestMissingABinaryIsRefused() {
        val sums = "${"a".repeat(64)}  seampact-linux-x64\n"

        val read = BinaryPins.fromSha256Sums("1.2.3", sums)

        assertEquals(BinaryFailureCode.PIN_MISSING, (read as BinaryPinsRead.Refused).failure.code)
    }

    @Test
    fun aManifestListingABinaryTwiceIsRefused() {
        val sums = BinaryPlatform.entries.joinToString("\n", postfix = "\n") { "${"a".repeat(64)}  ${it.assetName}" } +
            "${"b".repeat(64)}  seampact-linux-x64\n"

        val read = BinaryPins.fromSha256Sums("1.2.3", sums)

        assertEquals(BinaryFailureCode.PIN_INVALID, (read as BinaryPinsRead.Refused).failure.code)
    }

    @Test
    fun overridesWithoutAHashAreRefused() {
        val embedded = BinaryPins("1.0.0", BinaryPlatform.entries.associateWith { "e".repeat(64) })

        val path = BinaryPinning.pin(embedded, BinaryOverride.LocalPath(stub, null), linuxHost)
        val version = BinaryPinning.pin(embedded, BinaryOverride.Version("2.0.0", emptyMap()), linuxHost)

        assertEquals(BinaryFailureCode.PIN_MISSING, (path as BinaryPinResolution.Refused).failure.code)
        assertEquals(BinaryFailureCode.PIN_MISSING, (version as BinaryPinResolution.Refused).failure.code)
    }

    @Test
    fun theHostPicksTheArtefactOfThePins() {
        val embedded = BinaryPins("1.0.0", BinaryPlatform.entries.associateWith { it.ordinal.toString().repeat(64) })

        val pinned = BinaryPinning.pin(embedded, null, linuxHost) as BinaryPinResolution.Pinned
        val musl = BinaryPinning.pin(embedded, null, HostPlatform("Linux", "amd64", HostLibc.MUSL))
        val ownBuild = BinaryPinning.pin(embedded, BinaryOverride.LocalPath(stub, "f".repeat(64)), HostPlatform("Linux", "amd64", HostLibc.MUSL))

        assertEquals(BinaryPin.Artifact(BinaryPlatform.LINUX_X64, "1.0.0", "0".repeat(64)), pinned.pin)
        assertEquals("io.github.jubasse:seampact-compiler:1.0.0:linux-x86_64@exe", (pinned.pin as BinaryPin.Artifact).coordinates)
        assertEquals(BinaryFailureCode.PLATFORM_UNSUPPORTED, (musl as BinaryPinResolution.Refused).failure.code)
        assertEquals(BinaryPin.LocalFile(stub, "f".repeat(64)), (ownBuild as BinaryPinResolution.Pinned).pin)
    }

    @Test
    fun aPluginWithoutEmbeddedPinsRunsOnlyAnOverride() {
        val unpinned = BinaryPinning.pin(null, null, linuxHost)
        val ownBuild = BinaryPinning.pin(null, BinaryOverride.LocalPath(stub, "f".repeat(64)), linuxHost)

        assertEquals(BinaryFailureCode.PIN_MISSING, (unpinned as BinaryPinResolution.Refused).failure.code)
        assertEquals(BinaryPin.LocalFile(stub, "f".repeat(64)), (ownBuild as BinaryPinResolution.Pinned).pin)
    }

    private fun runStub(script: String): BinaryCompileResult {
        val binary = Files.writeString(work.resolve("script-stub"), "#!/bin/sh\n$script")
        binary.toFile().setExecutable(true)
        val install = install(binary, BinaryPin.LocalFile(binary, BinaryInstaller.sha256Of(binary)), work.resolve("cache"))
        check(install is BinaryInstall.Installed) { "$install" }
        val config = Files.writeString(work.resolve("seampact.config.yaml"), "targets: []\n")

        return BinaryRunner.compile(install.binary, config, IrSupport.ofModel(emptyList()))
    }
}
