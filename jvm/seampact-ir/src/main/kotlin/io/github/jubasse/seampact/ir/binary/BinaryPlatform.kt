package io.github.jubasse.seampact.ir.binary

/**
 * The platforms the standalone compiler binary is built for (ADR 0010): the release asset name, as
 * `packages/tools/binary/scripts/binary-names.mjs` lists it, and the Maven classifier of
 * `io.github.jubasse:seampact-compiler`, protoc's names for the same platform.
 */
public enum class BinaryPlatform(public val assetName: String, public val classifier: String) {
    LINUX_X64("seampact-linux-x64", "linux-x86_64"),
    LINUX_ARM64("seampact-linux-arm64", "linux-aarch_64"),
    DARWIN_X64("seampact-darwin-x64", "osx-x86_64"),
    DARWIN_ARM64("seampact-darwin-arm64", "osx-aarch_64"),
    WIN32_X64("seampact-win32-x64.exe", "windows-x86_64"),
    ;

    public companion object {
        /** The Maven coordinates' group, artifact and type of the binary artefacts. */
        public const val GROUP_ID: String = "io.github.jubasse"
        public const val ARTIFACT_ID: String = "seampact-compiler"
        public const val ARTIFACT_TYPE: String = "exe"

        /** The release manifest of the binaries' SHA-256 hashes, in `sha256sum` format. */
        public const val MANIFEST_FILE_NAME: String = "SHA256SUMS"

        public fun ofClassifier(classifier: String): BinaryPlatform? = entries.firstOrNull { it.classifier == classifier }

        public fun ofAssetName(assetName: String): BinaryPlatform? = entries.firstOrNull { it.assetName == assetName }
    }

    /** The Maven coordinates of this platform's binary at [version], `group:artifact:version:classifier@type`. */
    public fun coordinates(version: String): String = "$GROUP_ID:$ARTIFACT_ID:$version:$classifier@$ARTIFACT_TYPE"
}
