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
fn resolved(base_directory: &Utf8Path) -> Result<Utf8PathBuf, BundleError> {
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

/// The real directory of the package `name` as Node finds it from `base_directory`, or `None`.
///
/// # Errors
///
/// [`BundleError::Io`] when the found directory has no real path or it is not UTF-8.
pub(crate) fn installed_package_directory(
    name: &str,
    base_directory: &Utf8Path,
) -> Result<Option<Utf8PathBuf>, BundleError> {
    let mut directory = resolved(base_directory)?;

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
            resolved(base).unwrap(),
            Utf8PathBuf::from("/work/app/lib"),
            "base {base}"
        );
    }
}
