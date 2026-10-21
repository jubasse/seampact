package io.github.jubasse.seampact.ir.binary

import io.github.jubasse.seampact.ir.read.IrSupport
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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
        Files.writeString(stub, "#!/bin/sh\ntouch '$marker'\nexit 3\n")
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
        assertEquals(3, (result as BinaryCompileResult.Failed).exitCode)
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
}
