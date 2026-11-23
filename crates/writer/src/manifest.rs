//! The manifest of an output directory, version 2: its owner and each file with its hashes.

use camino::Utf8Path;

use crate::WriterError;
use crate::not_ported::not_ported_yet;

/// One file of a manifest.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ManifestEntry {
    /// The path, relative to the output directory.
    pub path: String,
    /// The SHA-256 of the bytes before the user's formatter ran; `sha256` without one.
    pub source: String,
    /// The SHA-256 of the bytes written.
    pub sha256: String,
    /// The user's formatter, when the entry has one.
    pub formatter: Option<String>,
}

/// The manifest of a directory as read: its owner and entries, or why it is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ManifestRead {
    /// The manifest, empty and without an owner when the directory has none.
    Read {
        /// The entry id or `openapi` that wrote the directory.
        owner: Option<String>,
        /// The files, in UTF-16 order of path.
        entries: Vec<ManifestEntry>,
    },
    /// The manifest cannot be read; the reason completes "the manifest is invalid: ".
    Invalid {
        /// Why.
        reason: String,
    },
}

/// Reads the manifest of `root_directory`; a missing one is an empty manifest without an owner.
///
/// # Errors
///
/// [`WriterError::NotPortedYet`] until the function is ported.
pub fn read_manifest(_root_directory: &Utf8Path) -> Result<ManifestRead, WriterError> {
    Err(not_ported_yet("readManifest"))
}

/// The manifest text of `owner` and its entries, version 2, written with `indented_json`.
///
/// # Errors
///
/// [`WriterError::NotPortedYet`] until the function is ported.
pub fn serialize_manifest(_owner: &str, _entries: &[ManifestEntry]) -> Result<String, WriterError> {
    Err(not_ported_yet("serializeManifest"))
}
