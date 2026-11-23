//! The output directory as the file system holds it: real paths, links that leave it, empty
//! directories to clean.

use std::fs;

use camino::{Utf8Path, Utf8PathBuf};
use seampact_diagnostics::InternalError;

use crate::WriterError;
use crate::file_presence::lstat_if_present;

fn real_path(path: &Utf8Path) -> Result<Utf8PathBuf, WriterError> {
    let resolved = fs::canonicalize(path).map_err(|error| WriterError::io(path, &error))?;

    Utf8PathBuf::try_from(resolved)
        .map_err(|error| WriterError::io(path, &std::io::Error::other(error)))
}

/// The real path of `directory`, or, when it is missing, of its nearest existing parent with the
/// missing names joined back.
pub(crate) fn real_path_of_missing(directory: &Utf8Path) -> Result<Utf8PathBuf, WriterError> {
    if lstat_if_present(directory)?.is_some() {
        return real_path(directory);
    }

    match (directory.parent(), directory.file_name()) {
        (Some(parent), Some(name)) => Ok(real_path_of_missing(parent)?.join(name)),
        _ => Ok(directory.to_path_buf()),
    }
}

/// Whether `path` is not `root` or below it.
pub(crate) fn is_outside(root: &Utf8Path, path: &Utf8Path) -> bool {
    !path.starts_with(root)
}

/// Whether the nearest existing directory of `file_path` resolves outside `root`, through a link.
pub(crate) fn leaves_root(root: &Utf8Path, file_path: &Utf8Path) -> Result<bool, WriterError> {
    let mut directory = parent_of(file_path)?;

    while lstat_if_present(directory)?.is_none() {
        // The output directory itself is not created yet, so nothing below it is a link.
        if directory == root {
            return Ok(false);
        }

        directory = parent_of(directory)?;
    }

    Ok(is_outside(root, &real_path(directory)?))
}

fn parent_of(path: &Utf8Path) -> Result<&Utf8Path, WriterError> {
    path.parent().ok_or_else(|| {
        InternalError::new(format!("'{path}' has no parent below the output directory")).into()
    })
}

/// Removes `directory` and then each parent below `root` while it is empty.
pub(crate) fn remove_empty_directories(
    root: &Utf8Path,
    directory: &Utf8Path,
) -> Result<(), WriterError> {
    let mut current = directory;

    while current != root && !is_outside(root, current) {
        let mut entries =
            fs::read_dir(current).map_err(|error| WriterError::io(current, &error))?;

        if entries.next().is_some() {
            return Ok(());
        }

        fs::remove_dir(current).map_err(|error| WriterError::io(current, &error))?;
        current = parent_of(current)?;
    }

    Ok(())
}
