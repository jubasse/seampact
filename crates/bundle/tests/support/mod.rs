//! Shared helper of the integration tests: the repository root.

use camino::Utf8PathBuf;

/// The repository root, two levels above the crate.
pub fn repository_root() -> Utf8PathBuf {
    Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
