//! Shared helper of the integration tests: the repository root.

use camino::Utf8PathBuf;

/// The repository root, two levels above the crate.
#[allow(dead_code, reason = "each test file uses its own helpers")]
pub fn repository_root() -> Utf8PathBuf {
    Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A new empty directory under the system temporary directory, named after the test.
#[allow(
    dead_code,
    clippy::unwrap_used,
    reason = "each test file uses its own helpers; a failed setup is the failed test"
)]
pub fn scratch_directory(name: &str) -> Utf8PathBuf {
    let directory = Utf8PathBuf::from_path_buf(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "seampact-bundle-test-{}-{name}",
            std::process::id()
        ));

    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();

    directory
}
