//! What the file system holds at a path, read without following a link, and where one path lies
//! against another by its text.

use std::fs::{self, Metadata};
use std::io::{ErrorKind, Result};

use camino::Utf8Path;

/// The metadata of `path` without following a symbolic link, `None` when there is nothing there.
///
/// # Errors
///
/// The system's error for any failure but a missing path.
pub fn lstat_if_present(path: &Utf8Path) -> Result<Option<Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// Whether `path` is a symbolic link, dangling or not; `false` when nothing is there.
///
/// # Errors
///
/// The system's error for any failure but a missing path.
pub fn is_symbolic_link(path: &Utf8Path) -> Result<bool> {
    Ok(lstat_if_present(path)?.is_some_and(|metadata| metadata.is_symlink()))
}

/// Whether `child` is `parent` or lies below it, by the text of the two paths: neither is
/// resolved against the file system.
#[must_use]
pub fn is_inside_or_equal(parent: &Utf8Path, child: &Utf8Path) -> bool {
    child.starts_with(parent)
}

/// Whether `child` lies below `parent` and is not `parent` itself, by the text of the two paths.
#[must_use]
pub fn is_strictly_inside(parent: &Utf8Path, child: &Utf8Path) -> bool {
    child != parent && is_inside_or_equal(parent, child)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sibling_named_like_a_prefix_is_not_inside_and_a_dot_dot_name_is() {
        let parent = Utf8Path::new("/out/app");

        assert!(!is_inside_or_equal(parent, Utf8Path::new("/out/app2")));
        assert!(is_inside_or_equal(parent, parent));
        assert!(is_strictly_inside(
            parent,
            Utf8Path::new("/out/app/..hidden")
        ));
        assert!(!is_strictly_inside(parent, parent));
    }

    #[test]
    fn a_link_is_seen_as_a_link_and_a_missing_path_as_nothing() {
        let directory = tempfile::tempdir().expect("a temporary directory");
        let root = Utf8Path::from_path(directory.path()).expect("a UTF-8 temporary path");
        let dangling = root.join("dangling");
        let file = root.join("file");

        std::os::unix::fs::symlink(root.join("missing"), &dangling).expect("a link");
        std::fs::write(&file, "text").expect("a file");

        assert!(is_symbolic_link(&dangling).expect("a link check"));
        assert!(!is_symbolic_link(&file).expect("a file check"));
        assert!(!is_symbolic_link(&root.join("missing")).expect("a missing check"));
        assert!(
            lstat_if_present(&root.join("missing"))
                .expect("a missing lstat")
                .is_none()
        );
        assert!(lstat_if_present(&dangling).expect("a link lstat").is_some());
    }
}
