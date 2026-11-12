//! Reading repository files for the integration tests.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// The repository root, two levels above this crate.
pub fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Every file under `directory` whose path satisfies `is_wanted`, sorted, at any depth.
pub fn files_under(
    directory: &Path,
    is_wanted: &dyn Fn(&Path) -> bool,
) -> io::Result<Vec<PathBuf>> {
    let mut found_files = Vec::new();
    let mut pending_directories = vec![directory.to_path_buf()];

    while let Some(current_directory) = pending_directories.pop() {
        for entry in fs::read_dir(&current_directory)? {
            let path = entry?.path();

            if path.is_dir() {
                pending_directories.push(path);
            } else if is_wanted(&path) {
                found_files.push(path);
            }
        }
    }

    found_files.sort();

    Ok(found_files)
}
