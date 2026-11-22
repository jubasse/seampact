//! Where Node finds an installed package: `node_modules` of a directory or of one above it.

use std::env;

use camino::{Utf8Component, Utf8Path, Utf8PathBuf};

use crate::BundleError;

const NODE_MODULES: &str = "node_modules";
const PACKAGE_MANIFEST: &str = "package.json";

fn io_error(path: &Utf8Path, message: String) -> BundleError {
    BundleError::Io {
        path: path.to_string(),
        message,
    }
}

/// `path.resolve`: absolute against the working directory, `.` and `..` collapsed in the text.
///
/// # Errors
///
/// [`BundleError::Io`] when the working directory is needed and is unreadable or not UTF-8.
pub fn resolve_directory(base_directory: &Utf8Path) -> Result<Utf8PathBuf, BundleError> {
    let absolute = if base_directory.is_absolute() {
        base_directory.to_path_buf()
    } else {
        let current = env::current_dir()
            .map_err(|error| io_error(base_directory, error.to_string()))
            .and_then(|current| {
                Utf8PathBuf::from_path_buf(current).map_err(|current| {
                    io_error(
                        base_directory,
                        format!("the working directory {} is not UTF-8", current.display()),
                    )
                })
            })?;

        current.join(base_directory)
    };
    let mut collapsed = Utf8PathBuf::new();

    for component in absolute.components() {
        match component {
            Utf8Component::CurDir => {}
            Utf8Component::ParentDir => {
                collapsed.pop();
            }
            Utf8Component::Prefix(_) | Utf8Component::RootDir | Utf8Component::Normal(_) => {
                collapsed.push(component.as_str());
            }
        }
    }

    Ok(collapsed)
}

/// Whether `name` is a plain or scoped npm package name; one with `..` or a root would climb out
/// of `node_modules`.
fn is_npm_package_name(name: &str) -> bool {
    let unscoped = match name.strip_prefix('@') {
        Some(scoped) => match scoped.split_once('/') {
            Some((scope, rest)) if is_name_segment(scope) => rest,
            _ => return false,
        },
        None => name,
    };

    is_name_segment(unscoped)
}

/// One segment: lower case letters, digits, `~`, `-`, and `.` or `_` after the first character.
fn is_name_segment(segment: &str) -> bool {
    let mut characters = segment.chars();
    let allowed_first =
        |c: char| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '~' || c == '-';

    characters.next().is_some_and(allowed_first)
        && characters.all(|c| allowed_first(c) || c == '.' || c == '_')
}

/// The real directory of the package `name` as Node finds it from `base_directory`, or `None`
/// (also when `name` is no npm package name).
///
/// # Errors
///
/// [`BundleError::Io`] when the found directory has no real path or it is not UTF-8.
pub fn installed_package_directory(
    name: &str,
    base_directory: &Utf8Path,
) -> Result<Option<Utf8PathBuf>, BundleError> {
    if !is_npm_package_name(name) {
        return Ok(None);
    }

    let mut directory = resolve_directory(base_directory)?;

    loop {
        let mut candidate = directory.join(NODE_MODULES);

        for segment in name.split('/').filter(|segment| !segment.is_empty()) {
            candidate.push(segment);
        }

        if candidate.join(PACKAGE_MANIFEST).exists() {
            return candidate
                .canonicalize_utf8()
                .map(Some)
                .map_err(|error| io_error(&candidate, error.to_string()));
        }

        let Some(parent) = directory.parent() else {
            return Ok(None);
        };

        directory = parent.to_path_buf();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_relative_base_collapses_dots_before_climbing() {
        let base = Utf8Path::new("/work/app/./sub/../lib");

        assert_eq!(
            resolve_directory(base).unwrap(),
            Utf8PathBuf::from("/work/app/lib"),
            "base {base}"
        );
    }

    #[test]
    fn a_name_that_climbs_out_of_node_modules_is_not_installed() {
        let root = tempfile::tempdir().unwrap();
        let root = Utf8Path::from_path(root.path()).unwrap();
        let project = root.join("project");

        std::fs::create_dir_all(project.join(NODE_MODULES)).unwrap();
        std::fs::create_dir_all(root.join("outside")).unwrap();
        std::fs::write(
            root.join("outside").join(PACKAGE_MANIFEST),
            r#"{"version":"9.9.9"}"#,
        )
        .unwrap();

        assert_eq!(
            installed_package_directory("../../outside", &project).unwrap(),
            None
        );
    }

    #[test]
    fn npm_package_names_are_plain_or_scoped() {
        for name in ["notes", "@acme/notes", "a.b_c-d~e"] {
            assert!(is_npm_package_name(name), "name {name}");
        }

        for name in [
            "", "../x", "/abs", "@acme", "@acme/", "a/b", "Notes", ".hidden", "@a/b/c",
        ] {
            assert!(!is_npm_package_name(name), "name {name}");
        }
    }
}
