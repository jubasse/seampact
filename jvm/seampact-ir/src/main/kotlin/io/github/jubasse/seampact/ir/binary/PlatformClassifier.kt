package io.github.jubasse.seampact.ir.binary

import java.nio.file.Files
import java.nio.file.Path

/** The C library of a Linux host; other systems have none to tell apart. */
public enum class HostLibc(public val label: String) {
    GLIBC("glibc"),
    MUSL("musl"),
    NONE("no libc check"),
}

/** The host as the JVM reports it: `os.name`, `os.arch` and, on Linux, the C library. */
public data class HostPlatform(val osName: String, val osArch: String, val libc: HostLibc) {
    public companion object {
        // The JVM's own memory map names the C library it runs on. Without `/proc`, musl's dynamic loader,
        // `/lib/ld-musl-<arch>.so.1`, present on every musl system (Alpine and others), is the fallback sign.
        private const val PROCESS_MAPS = "/proc/self/maps"
        private const val LIBRARY_DIRECTORY = "/lib"
        private const val MUSL_LOADER_PREFIX = "ld-musl-"
        private val MUSL_MAPPED_NAMES = listOf(MUSL_LOADER_PREFIX, "libc.musl-")
        private const val GLIBC_MAPPED_NAME = "libc.so.6"

        /** The running JVM's host. */
        public fun current(): HostPlatform {
            val osName = System.getProperty("os.name")
            val libc = if (osName.startsWith(LINUX)) linuxLibc(Path.of(PROCESS_MAPS), Path.of(LIBRARY_DIRECTORY)) else HostLibc.NONE

            return HostPlatform(osName, System.getProperty("os.arch"), libc)
        }

        /**
         * The libc the JVM has mapped, read from [processMaps]: musl when a mapped file is musl's loader or libc,
         * glibc when it is `libc.so.6`. When [processMaps] is unreadable or names neither, musl when
         * [libraryDirectory] holds an `ld-musl-*` loader, glibc otherwise.
         */
        public fun linuxLibc(processMaps: Path, libraryDirectory: Path): HostLibc =
            mappedLibc(processMaps) ?: libcFromLibraryDirectory(libraryDirectory)

        private fun mappedLibc(processMaps: Path): HostLibc? {
            if (!Files.isReadable(processMaps)) return null

            val mappedFiles = Files.readAllLines(processMaps).map { line -> line.substringAfterLast('/') }
            if (mappedFiles.any { file -> MUSL_MAPPED_NAMES.any { file.startsWith(it) } }) return HostLibc.MUSL
            if (mappedFiles.any { file -> file.startsWith(GLIBC_MAPPED_NAME) }) return HostLibc.GLIBC

            return null
        }

        private fun libcFromLibraryDirectory(libraryDirectory: Path): HostLibc {
            if (!Files.isDirectory(libraryDirectory)) return HostLibc.GLIBC

            val hasMuslLoader = Files.list(libraryDirectory).use { entries ->
                entries.anyMatch { it.fileName.toString().startsWith(MUSL_LOADER_PREFIX) }
            }

            return if (hasMuslLoader) HostLibc.MUSL else HostLibc.GLIBC
        }
    }
}

private const val LINUX = "Linux"
private const val MAC_OS = "Mac OS X"
private const val WINDOWS_PREFIX = "Windows"

private enum class Arch { X64, ARM64 }

/** The outcome of [PlatformClassifier.classify]. */
public sealed interface PlatformClassification {
    public data class Supported(val platform: BinaryPlatform) : PlatformClassification

    public data class Unsupported(val failure: BinaryFailure) : PlatformClassification
}

/**
 * Maps a host to the binary built for it (ADR 0010 platforms): linux x64 and arm64 with glibc, macOS x64 and arm64,
 * Windows x64. Any other host is refused by name (`binary.platform-unsupported`), naming its OS, arch and libc:
 * linux with musl, FreeBSD, Windows arm64 and every other OS or arch.
 */
public object PlatformClassifier {
    public fun classify(host: HostPlatform): PlatformClassification {
        val arch = archOf(host.osArch) ?: return unsupported(host)

        val platform = when {
            host.osName == LINUX && host.libc == HostLibc.GLIBC ->
                if (arch == Arch.X64) BinaryPlatform.LINUX_X64 else BinaryPlatform.LINUX_ARM64
            host.osName == MAC_OS -> if (arch == Arch.X64) BinaryPlatform.DARWIN_X64 else BinaryPlatform.DARWIN_ARM64
            host.osName.startsWith(WINDOWS_PREFIX) && arch == Arch.X64 -> BinaryPlatform.WIN32_X64
            else -> null
        }

        return if (platform == null) unsupported(host) else PlatformClassification.Supported(platform)
    }

    private fun archOf(osArch: String): Arch? = when (osArch) {
        "amd64", "x86_64" -> Arch.X64
        "aarch64", "arm64" -> Arch.ARM64
        else -> null
    }

    private fun unsupported(host: HostPlatform): PlatformClassification = PlatformClassification.Unsupported(
        BinaryFailure(
            code = BinaryFailureCode.PLATFORM_UNSUPPORTED,
            message = "The standalone compiler binary has no build for this host: os.name '${host.osName}', " +
                "os.arch '${host.osArch}', libc ${host.libc.label}. It is built for linux x64 and arm64 (glibc), " +
                "macOS x64 and arm64, and Windows x64.",
            fix = "Use a bundle source, which needs no binary; or build on a glibc image of a supported platform; " +
                "or point the binary `path` at your own build of the compiler, with its SHA-256.",
            actual = "${host.osName} ${host.osArch} ${host.libc.label}",
        ),
    )
}
