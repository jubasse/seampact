package io.github.jubasse.seampact.ir.bundle

import java.security.MessageDigest
import java.util.Base64
import java.util.HexFormat

// The bundle integrity (`schemas/bundle/README.md`, "Integrity"): one line per listed file,
// `<sha256 lowercase hex>  <path>\n`, sorted by path in code-unit order, the manifest excluded, encoded as UTF-8;
// the integrity is `sha256-` and the padded standard base64 of its SHA-256, the SRI form npm uses.

private const val INTEGRITY_PREFIX = "sha256-"
private const val SHA_256 = "SHA-256"

/** The lowercase hexadecimal SHA-256 of [bytes]. */
internal fun sha256Hex(bytes: ByteArray): String = HexFormat.of().formatHex(MessageDigest.getInstance(SHA_256).digest(bytes))

/** The integrity of [files], in any order. */
public fun bundleIntegrity(files: List<BundleFile>): String {
    val canonicalList = files.sortedWith { left, right -> compareBundlePaths(left.path, right.path) }
        .joinToString("") { "${it.sha256}  ${it.path}\n" }
    val digest = MessageDigest.getInstance(SHA_256).digest(canonicalList.toByteArray(Charsets.UTF_8))

    return INTEGRITY_PREFIX + Base64.getEncoder().encodeToString(digest)
}
