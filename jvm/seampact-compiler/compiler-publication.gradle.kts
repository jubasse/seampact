// The standalone compiler binaries as Maven artefacts (ADR 0010, "Distribution and pinning"): one publication,
// `io.github.jubasse:seampact-compiler:<version>`, with one artefact of type `exe` per platform classifier. The
// binaries come from `-PseampactBinariesDir=<dir>`, the release assets beside their `SHA256SUMS`; each is checked
// against the manifest before it is staged, so a published file always has the hash the release lists.
// `-PseampactCompilerVersion=<version>` is the release version, the CLI's. Applied by `build.gradle.kts`, and alone
// by the publication test.

import java.security.MessageDigest
import java.util.HexFormat

apply(plugin = "maven-publish")

// Release asset to Maven classifier (ADR 0010): seampact-ir's `BinaryPlatform` holds the same table, and the
// publication test checks that both agree.
val classifierByAssetName = linkedMapOf(
    "seampact-linux-x64" to "linux-x86_64",
    "seampact-linux-arm64" to "linux-aarch_64",
    "seampact-darwin-x64" to "osx-x86_64",
    "seampact-darwin-arm64" to "osx-aarch_64",
    "seampact-win32-x64.exe" to "windows-x86_64",
)
val manifestFileName = "SHA256SUMS"
val binariesDirectoryProperty = "seampactBinariesDir"
val compilerVersionProperty = "seampactCompilerVersion"
val unsetVersion = "unspecified"

val binariesDirectory: String? = providers.gradleProperty(binariesDirectoryProperty).orNull
val compilerVersion: String? = providers.gradleProperty(compilerVersionProperty).orNull
val stagedDirectory = layout.buildDirectory.dir("compiler-binaries")

version = compilerVersion ?: unsetVersion

fun sha256Of(file: File): String = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(file.readBytes()))

// The manifest's hash of each asset; exactly the five assets, each once.
fun manifestHashes(manifest: File): Map<String, String> {
    val hashes = linkedMapOf<String, String>()
    for (line in manifest.readLines().filter { it.isNotEmpty() }) {
        val asset = line.substringAfter("  ", missingDelimiterValue = "")
        if (asset !in classifierByAssetName) throw GradleException("$manifest lists '$asset', which is not a release binary.")
        if (asset in hashes) throw GradleException("$manifest lists '$asset' twice.")
        hashes[asset] = line.substringBefore("  ")
    }
    val missing = classifierByAssetName.keys - hashes.keys
    if (missing.isNotEmpty()) throw GradleException("$manifest lists no hash for ${missing.joinToString(", ")}.")

    return hashes
}

val stageCompilerBinaries = tasks.register("stageCompilerBinaries") {
    description = "Checks the release binaries against their SHA256SUMS and stages them for the compiler publication."
    group = PublishingPlugin.PUBLISH_TASK_GROUP
    if (binariesDirectory != null) inputs.dir(binariesDirectory)
    inputs.property("compilerVersion", compilerVersion ?: unsetVersion)
    outputs.dir(stagedDirectory)

    doLast {
        val source = binariesDirectory?.let(::file) ?: throw GradleException(
            "The compiler publication needs -P$binariesDirectoryProperty=<dir>, the five release binaries beside their $manifestFileName.",
        )
        if (compilerVersion == null) {
            throw GradleException("The compiler publication needs -P$compilerVersionProperty=<version>, the release version.")
        }

        val present = source.list()?.toSet() ?: throw GradleException("'$source' is not a directory.")
        val unexpected = present - classifierByAssetName.keys - manifestFileName
        if (unexpected.isNotEmpty()) throw GradleException("'$source' holds files that are no release binary: ${unexpected.sorted().joinToString(", ")}.")

        val hashes = manifestHashes(source.resolve(manifestFileName))
        val target = stagedDirectory.get().asFile
        target.deleteRecursively()
        target.mkdirs()

        for (asset in classifierByAssetName.keys) {
            val binary = source.resolve(asset)
            if (!binary.isFile) throw GradleException("'$binary' is missing; $manifestFileName lists it.")

            // The staged copy is hashed, not the source: the published bytes are the ones checked.
            val staged = binary.copyTo(target.resolve(asset))
            val actual = sha256Of(staged)
            val expected = hashes.getValue(asset)
            if (actual != expected) {
                throw GradleException("'$binary' has the SHA-256 $actual once staged; $manifestFileName lists $expected. It is not published.")
            }
        }
    }
}

configure<PublishingExtension> {
    publications {
        create<MavenPublication>("compiler") {
            artifactId = "seampact-compiler"
            for ((asset, assetClassifier) in classifierByAssetName) {
                artifact(stagedDirectory.get().file(asset).asFile) {
                    classifier = assetClassifier
                    extension = "exe"
                    builtBy(stageCompilerBinaries)
                }
            }
            pom {
                name = "seampact-compiler"
                description = "The seampact standalone compiler binary, one artefact per platform classifier."
            }
        }
    }
}
