//! The walk of a bundle directory: every regular file with its size, under the caps.

use std::collections::HashMap;
use std::fs;

use camino::{Utf8Path, Utf8PathBuf};
use seampact_diagnostics::quote_text;

use crate::limits::{BUNDLE_ENTRIES_MAX, BUNDLE_EXTRACTED_BYTES_MAX};
use crate::refetch::REFETCH_FIX;
use crate::{BundleError, BundleFailure, BundleFailureCode};

const FIX_TOO_LARGE: &str =
    "Check that the source names a seampact bundle; a bundle this large is not one.";

/// The sizes of a bundle's files by path, or the failure that stops the walk.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum BundleWalk {
    /// Every file's size by its path below the bundle root.
    Sizes(HashMap<String, u64>),
    /// A link, a special file or a cap crossed.
    Refused(BundleFailure),
}

fn io_error(path: &Utf8Path, error: &std::io::Error) -> BundleError {
    BundleError::Io {
        path: path.to_string(),
        message: error.to_string(),
    }
}

/// Lists every file below `directory`; a directory is walked, a link or special file refused.
pub(crate) fn walk_bundle(directory: &Utf8Path) -> Result<BundleWalk, BundleError> {
    let extracted_max = u64::try_from(BUNDLE_EXTRACTED_BYTES_MAX).unwrap_or(u64::MAX);
    let mut sizes: HashMap<String, u64> = HashMap::new();
    let mut pending = vec![String::new()];
    let mut total: u64 = 0;

    while let Some(relative) = pending.pop() {
        let folder = directory.join(&relative);
        let entries = fs::read_dir(&folder).map_err(|error| io_error(&folder, &error))?;

        for entry in entries {
            let entry = entry.map_err(|error| io_error(&folder, &error))?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|name| BundleError::Io {
                    path: folder.to_string(),
                    message: format!("the entry {} is not UTF-8", name.display()),
                })?;
            let path = if relative.is_empty() {
                name
            } else {
                format!("{relative}/{name}")
            };
            let file_type = entry
                .file_type()
                .map_err(|error| io_error(&folder, &error))?;

            if file_type.is_dir() {
                pending.push(path);

                continue;
            }

            if !file_type.is_file() {
                return Ok(BundleWalk::Refused(
                    BundleFailure::new(
                        BundleFailureCode::FileType,
                        format!(
                            "{} is a link or a special file; a bundle holds regular files only.",
                            quote_text(&path)
                        ),
                        REFETCH_FIX,
                    )
                    .about(&path),
                ));
            }

            let file = Utf8PathBuf::from(directory).join(&path);
            let size = fs::symlink_metadata(&file)
                .map_err(|error| io_error(&file, &error))?
                .len();

            total = total.saturating_add(size);
            sizes.insert(path, size);

            if sizes.len() > BUNDLE_ENTRIES_MAX || total > extracted_max {
                return Ok(BundleWalk::Refused(over_cap(sizes.len(), total)));
            }
        }
    }

    Ok(BundleWalk::Sizes(sizes))
}

fn over_cap(file_count: usize, total: u64) -> BundleFailure {
    if file_count > BUNDLE_ENTRIES_MAX {
        return BundleFailure::new(
            BundleFailureCode::TooManyFiles,
            format!("The bundle holds more than {BUNDLE_ENTRIES_MAX} files."),
            FIX_TOO_LARGE,
        )
        .expecting(BUNDLE_ENTRIES_MAX.to_string());
    }

    BundleFailure::new(
        BundleFailureCode::TooLarge,
        format!(
            "The bundle's files hold more than {BUNDLE_EXTRACTED_BYTES_MAX} bytes ({total} so far)."
        ),
        FIX_TOO_LARGE,
    )
    .expecting(BUNDLE_EXTRACTED_BYTES_MAX.to_string())
}
