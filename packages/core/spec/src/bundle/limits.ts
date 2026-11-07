// The caps of a bundle reader (a bundle comes from the network: A46's trust covers the config only). Every
// verifier applies them, so a bundle one reader refuses for size, every reader refuses.

const MEBIBYTE = 1024 * 1024;

/** A tarball's compressed bytes. */
export const BUNDLE_ARCHIVE_BYTES_MAX = 64 * MEBIBYTE;

/** A tarball's uncompressed bytes, and the sum of a bundle directory's file sizes. */
export const BUNDLE_EXTRACTED_BYTES_MAX = 256 * MEBIBYTE;

/** The entries of a tarball, and the files of a bundle directory. */
export const BUNDLE_ENTRIES_MAX = 10_000;

/** The manifest's bytes. */
export const BUNDLE_MANIFEST_BYTES_MAX = MEBIBYTE;
