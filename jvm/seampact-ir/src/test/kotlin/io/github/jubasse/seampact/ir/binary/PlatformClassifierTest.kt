package io.github.jubasse.seampact.ir.binary

import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// Every `os.name`, `os.arch` and libc triple maps to the binary built for it, or to the refusal naming the host.
class PlatformClassifierTest {
    private fun classified(osName: String, osArch: String, libc: HostLibc): BinaryPlatform? =
        when (val classification = PlatformClassifier.classify(HostPlatform(osName, osArch, libc))) {
            is PlatformClassification.Supported -> classification.platform
            is PlatformClassification.Unsupported -> {
                assertEquals(BinaryFailureCode.PLATFORM_UNSUPPORTED, classification.failure.code)
                assertTrue(classification.failure.message.contains(osName), classification.failure.message)
                assertTrue(classification.failure.message.contains(osArch), classification.failure.message)
                assertTrue(classification.failure.message.contains(libc.label), classification.failure.message)
                null
            }
        }

    @Test
    fun supportedHostsMapToTheirBinary() {
        assertEquals(BinaryPlatform.LINUX_X64, classified("Linux", "amd64", HostLibc.GLIBC))
        assertEquals(BinaryPlatform.LINUX_X64, classified("Linux", "x86_64", HostLibc.GLIBC))
        assertEquals(BinaryPlatform.LINUX_ARM64, classified("Linux", "aarch64", HostLibc.GLIBC))
        assertEquals(BinaryPlatform.DARWIN_X64, classified("Mac OS X", "x86_64", HostLibc.NONE))
        assertEquals(BinaryPlatform.DARWIN_ARM64, classified("Mac OS X", "aarch64", HostLibc.NONE))
        assertEquals(BinaryPlatform.WIN32_X64, classified("Windows 11", "amd64", HostLibc.NONE))
        assertEquals(BinaryPlatform.WIN32_X64, classified("Windows Server 2025", "amd64", HostLibc.NONE))
    }

    @Test
    fun otherHostsAreRefusedByName() {
        assertEquals(null, classified("Linux", "amd64", HostLibc.MUSL))
        assertEquals(null, classified("Linux", "aarch64", HostLibc.MUSL))
        assertEquals(null, classified("FreeBSD", "amd64", HostLibc.NONE))
        assertEquals(null, classified("Windows 11", "aarch64", HostLibc.NONE))
        assertEquals(null, classified("Linux", "riscv64", HostLibc.GLIBC))
        assertEquals(null, classified("Linux", "x86", HostLibc.GLIBC))
        assertEquals(null, classified("SunOS", "sparcv9", HostLibc.NONE))
    }

    @Test
    fun muslIsDetectedByItsLoader() {
        val library = Files.createTempDirectory("seampact-lib-")
        try {
            Files.createFile(library.resolve("libc.so.6"))
            assertEquals(HostLibc.GLIBC, HostPlatform.linuxLibc(library))

            Files.createFile(library.resolve("ld-musl-x86_64.so.1"))
            assertEquals(HostLibc.MUSL, HostPlatform.linuxLibc(library))
        } finally {
            library.toFile().deleteRecursively()
        }
    }

    @Test
    fun theAssetNamesAreTheReleaseBinaries() {
        val namesScript = Path.of(System.getProperty("seampact.repositoryRoot"), "packages/tools/binary/scripts/binary-names.mjs")
        val releaseNames = Regex("\"(seampact-[^\"]+)\"").findAll(namesScript.readText()).map { it.groupValues[1] }.toList()

        assertEquals(releaseNames, BinaryPlatform.entries.map { it.assetName })
    }
}
