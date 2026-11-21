//! The caps of a bundle reader: a bundle comes from the network, so every verifier applies them.

const MEBIBYTE: usize = 1024 * 1024;

/// A tarball's compressed bytes.
pub const BUNDLE_ARCHIVE_BYTES_MAX: usize = 64 * MEBIBYTE;

/// A tarball's uncompressed bytes, and the sum of a bundle directory's file sizes.
pub const BUNDLE_EXTRACTED_BYTES_MAX: usize = 256 * MEBIBYTE;

/// The entries of a tarball, and the files of a bundle directory.
pub const BUNDLE_ENTRIES_MAX: usize = 10_000;

/// The manifest's bytes.
pub const BUNDLE_MANIFEST_BYTES_MAX: usize = MEBIBYTE;
