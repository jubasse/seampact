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

        val install = BinaryInstaller.install(stub, wrongPin, work.resolve("cache"))

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
        val install = BinaryInstaller.install(stub, pin, work.resolve("cache"))
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
        val install = BinaryInstaller.install(stub, pin, work.resolve("cache"))
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

        val install = BinaryInstaller.install(stub, BinaryPin.LocalFile(stub, sha256), work.resolve("cache"))

        assertEquals(BinaryFailureCode.CACHE_UNSAFE, (install as BinaryInstall.Refused).failure.code)
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun aCacheEntryOtherUsersMayWriteIsRefusedAndANewOneIsOwnerOnly() {
        val sha256 = BinaryInstaller.sha256Of(stub)
        val install = BinaryInstaller.install(stub, BinaryPin.LocalFile(stub, sha256), work.resolve("cache"))
        check(install is BinaryInstall.Installed)
        val entry = install.binary.path.parent
        assertEquals("rwx------", PosixFilePermissions.toString(Files.getPosixFilePermissions(entry)))

        Files.setPosixFilePermissions(entry, PosixFilePermissions.fromString("rwxrwxrwx"))
        val again = BinaryInstaller.install(stub, BinaryPin.LocalFile(stub, sha256), work.resolve("cache"))

        assertEquals(BinaryFailureCode.CACHE_UNSAFE, (again as BinaryInstall.Refused).failure.code)
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun anInstalledBinaryIsOwnerOnlyWhateverTheUmaskAndIsReusedByTheNextBuild() {
        val pin = BinaryPin.LocalFile(stub, BinaryInstaller.sha256Of(stub))

        val first = BinaryInstaller.install(stub, pin, work.resolve("cache"))
        val second = BinaryInstaller.install(stub, pin, work.resolve("cache"))

        check(first is BinaryInstall.Installed)
        assertEquals("rwx------", PosixFilePermissions.toString(Files.getPosixFilePermissions(first.binary.path)))
        assertTrue(second is BinaryInstall.Installed, "$second")
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun theCacheRootAndEachDirectoryTheRunnerCreatesAreOwnerOnlyWhateverTheUmask() {
        val cacheRoot = work.resolve("home").resolve("caches").resolve("binaries")
        val install = BinaryInstaller.install(stub, BinaryPin.LocalFile(stub, BinaryInstaller.sha256Of(stub)), cacheRoot)

        check(install is BinaryInstall.Installed) { "$install" }
        for (directory in listOf(work.resolve("home"), work.resolve("home/caches"), cacheRoot, install.binary.path.parent)) {
            assertEquals("rwx------", PosixFilePermissions.toString(Files.getPosixFilePermissions(directory)), "$directory")
        }
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun aCacheRootTheGroupMayWriteIsRefusedNamingChmod() {
        val cacheRoot = Files.createDirectory(work.resolve("shared-cache"))
        Files.setPosixFilePermissions(cacheRoot, PosixFilePermissions.fromString("rwxrwx---"))

        val install = BinaryInstaller.install(stub, BinaryPin.LocalFile(stub, BinaryInstaller.sha256Of(stub)), cacheRoot)

        val failure = (install as BinaryInstall.Refused).failure
        assertEquals(BinaryFailureCode.CACHE_UNSAFE, failure.code)
        assertTrue(failure.message.contains("chmod 700"), failure.message)
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun aCacheOpenedToOthersAfterTheInstallIsCheckedRightBeforeTheStart() {
        val install = BinaryInstaller.install(stub, BinaryPin.LocalFile(stub, BinaryInstaller.sha256Of(stub)), work.resolve("cache"))
        check(install is BinaryInstall.Installed)
        Files.setPosixFilePermissions(install.binary.path.parent, PosixFilePermissions.fromString("rwxrwxrwx"))
        val config = Files.writeString(work.resolve("seampact.config.yaml"), "targets: []\n")

        val result = BinaryRunner.compile(install.binary, config, IrSupport.ofModel(emptyList()))

        assertEquals(BinaryFailureCode.CACHE_UNSAFE, (result as BinaryCompileResult.Refused).failure.code)
        assertFalse(Files.exists(marker))
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
        val install = BinaryInstaller.install(binary, BinaryPin.LocalFile(binary, BinaryInstaller.sha256Of(binary)), work.resolve("cache"))
        check(install is BinaryInstall.Installed) { "$install" }
        val config = Files.writeString(work.resolve("seampact.config.yaml"), "targets: []\n")

        return BinaryRunner.compile(install.binary, config, IrSupport.ofModel(emptyList()))
    }
}
