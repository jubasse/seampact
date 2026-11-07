package io.github.jubasse.seampact.ir.bundle

// The bundle layout and the caps every reader applies (`@seampact/spec/bundle`, `manifest.ts` and `limits.ts`): a
// bundle comes from the network, so a bundle one reader refuses for size, every reader refuses.

internal const val BUNDLE_MANIFEST_FILE = "seampact-bundle.json"
internal const val BUNDLE_SOURCES_DIRECTORY = "sources"
internal const val BUNDLE_IR_DIRECTORY = "ir"

private const val MEBIBYTE = 1024 * 1024

/** A tarball's compressed bytes. */
internal const val BUNDLE_ARCHIVE_BYTES_MAX = 64 * MEBIBYTE

/** A tarball's uncompressed bytes, and the sum of a bundle directory's file sizes. */
internal const val BUNDLE_EXTRACTED_BYTES_MAX = 256 * MEBIBYTE

/** The entries of a tarball, and the files of a bundle directory. */
internal const val BUNDLE_ENTRIES_MAX = 10_000

/** The manifest's bytes. */
internal const val BUNDLE_MANIFEST_BYTES_MAX = MEBIBYTE

// The fixes the reader and the verifier share.
internal const val REFETCH_FIX =
    "Fetch the bundle again from its source; if it fails again, the source holds a tampered bundle."
internal const val NOT_A_BUNDLE_FIX = "Check that the source names a seampact bundle; a bundle this large is not one."
internal const val REBUILD_FIX = "Download the bundle again, or rebuild it with `seampact bundle`."
