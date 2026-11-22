//! A directory the fetch made and removes when it is done with it.

use std::fs;

use camino::{Utf8Path, Utf8PathBuf};

/// A directory removed, with what it holds, when the value drops.
#[derive(Debug)]
pub(crate) struct RemovedOnDrop {
    path: Utf8PathBuf,
}

impl RemovedOnDrop {
    /// Takes ownership of the removal of `path`.
    pub(crate) const fn new(path: Utf8PathBuf) -> Self {
        Self { path }
    }

    /// The directory.
    pub(crate) fn path(&self) -> &Utf8Path {
        &self.path
    }
}

impl Drop for RemovedOnDrop {
    fn drop(&mut self) {
        // A directory that is already gone, or cannot be removed, leaves only a temporary file.
        let _ = fs::remove_dir_all(&self.path);
    }
}
