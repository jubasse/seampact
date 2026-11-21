//! The files of a bundle, before they are written.

use indexmap::IndexMap;
use seampact_json::canonical_document;

use crate::file_list::compare_bundle_paths;
use crate::{BUNDLE_MANIFEST_FILE, BundleManifest};

/// The files of a bundle and its manifest, before they are written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleContents {
    /// The `manifest` member.
    pub manifest: BundleManifest,
    /// Every listed file's bytes by bundle path; the manifest is not one of them.
    pub files: IndexMap<String, Vec<u8>>,
}

/// One file of a bundle as the writers write it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleEntry {
    /// The bundle path.
    pub path: String,
    /// The file's bytes.
    pub bytes: Vec<u8>,
}

/// The manifest's bytes: byte-stable JSON as UTF-8.
#[must_use]
pub fn bundle_manifest_bytes(manifest: &BundleManifest) -> Vec<u8> {
    canonical_document(&manifest.to_json_value()).into_bytes()
}

/// The manifest and every file, sorted by path: what the directory and tarball writers write.
#[must_use]
pub fn bundle_entries(contents: &BundleContents) -> Vec<BundleEntry> {
    let manifest = BundleEntry {
        path: BUNDLE_MANIFEST_FILE.to_owned(),
        bytes: bundle_manifest_bytes(&contents.manifest),
    };
    let mut entries = vec![manifest];

    entries.extend(contents.files.iter().map(|(path, bytes)| BundleEntry {
        path: path.clone(),
        bytes: bytes.clone(),
    }));
    entries.sort_by(|left, right| compare_bundle_paths(&left.path, &right.path));

    entries
}
