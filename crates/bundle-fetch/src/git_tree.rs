//! The files of a tag's tree, read with `git ls-tree` and `git cat-file`, never through a work
//! tree, so `autocrlf`, attributes, smudge filters and LFS cannot change a byte.
//!
//! The tree is untrusted: a link, a submodule, an unportable path or a case-fold duplicate is
//! refused before anything is written.

use std::fs::{self, OpenOptions};
use std::io::Write;

use camino::Utf8Path;
use seampact_bundle::{
    BUNDLE_ENTRIES_MAX, BUNDLE_EXTRACTED_BYTES_MAX, BUNDLE_MANIFEST_FILE, BundleFailureCode,
    bundle_path_fold, bundle_path_problem,
};
use seampact_diagnostics::quote_text;

use crate::git_run::{GitFailure, GitRunner};
use crate::{BundleSourceFailure, BundleSourceFailureCode};

/// The ref `git fetch` leaves the fetched commit under.
const FETCHED: &str = "FETCH_HEAD";

const REGULAR_FILE_MODES: [&str; 2] = ["100644", "100755"];
const FIX_TOO_LARGE: &str =
    "Check that the source names a seampact bundle; a bundle this large is not one.";

/// A blob of the tag's tree below the bundle directory.
#[derive(Debug, Clone, PartialEq, Eq)]
struct TreeFile {
    path: String,
    object: String,
}

/// The files of a tree, or the failure that refuses it.
#[derive(Debug, Clone, PartialEq)]
enum TreeFiles {
    Files(Vec<TreeFile>),
    Refused(BundleSourceFailure),
}

fn archive_failure(code: BundleFailureCode, message: String, fix: &str) -> BundleSourceFailure {
    BundleSourceFailure::new(BundleSourceFailureCode::Bundle(code), message, fix)
}

/// Reads the tree of the fetched tag and writes the files below `prefix` into the new directory
/// `target`, or answers the failure that refuses the tree.
///
/// # Errors
///
/// A [`GitFailure`] when a command fails or a file cannot be written.
pub(crate) fn write_tree(
    git: &GitRunner,
    prefix: &str,
    target: &Utf8Path,
) -> Result<Option<BundleSourceFailure>, GitFailure> {
    let listing = git.run(&["ls-tree", "-r", "-z", "--full-tree", FETCHED], None)?;
    let files = match tree_files(&String::from_utf8_lossy(&listing), prefix) {
        TreeFiles::Files(files) => files,
        TreeFiles::Refused(failure) => return Ok(Some(failure)),
    };

    fs::create_dir(target).map_err(|error| write_failure(&error))?;

    let mut total: usize = 0;

    for file in &files {
        let bytes = git.run(&["cat-file", "blob", &file.object], None)?;

        total = total.saturating_add(bytes.len());

        if total > BUNDLE_EXTRACTED_BYTES_MAX {
            return Ok(Some(
                archive_failure(
                    BundleFailureCode::ArchiveExtractedTooLarge,
                    format!(
                        "The tag's bundle files hold more than {BUNDLE_EXTRACTED_BYTES_MAX} bytes."
                    ),
                    FIX_TOO_LARGE,
                )
                .expecting(BUNDLE_EXTRACTED_BYTES_MAX.to_string()),
            ));
        }

        let mut path = target.to_path_buf();

        path.extend(file.path.split('/'));

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| write_failure(&error))?;
        }

        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .and_then(|mut written| written.write_all(&bytes))
            .map_err(|error| write_failure(&error))?;
    }

    Ok(None)
}

fn write_failure(error: &std::io::Error) -> GitFailure {
    GitFailure::Message(error.to_string())
}

/// The blobs of a `git ls-tree -r -z` listing below `prefix`, or the failure of the first entry
/// that is no bundle file.
fn tree_files(listing: &str, prefix: &str) -> TreeFiles {
    let mut files: Vec<TreeFile> = Vec::new();
    let mut folded: Vec<String> = Vec::new();

    for line in listing.split('\0') {
        if line.is_empty() {
            continue;
        }

        let (header, full_path) = line
            .split_once('\t')
            .unwrap_or_else(|| (without_last_character(line), line));
        let mut fields = header.split(' ');
        let mode = fields.next().unwrap_or("");
        let object_type = fields.next().unwrap_or("");
        let object = fields.next().unwrap_or("");
        let Some(path) = full_path.strip_prefix(prefix) else {
            continue;
        };

        if object_type != "blob" || !REGULAR_FILE_MODES.contains(&mode) {
            return TreeFiles::Refused(
                archive_failure(
                    BundleFailureCode::ArchiveEntryType,
                    format!(
                        "{} is a link or a submodule in the tag's tree; a bundle holds regular files only.",
                        quote_text(path)
                    ),
                    "Commit the bundle's files as regular files.",
                )
                .about(path),
            );
        }

        let problem = if path == BUNDLE_MANIFEST_FILE {
            None
        } else {
            bundle_path_problem(path)
        };

        if let Some(problem) = problem {
            return TreeFiles::Refused(
                archive_failure(
                    BundleFailureCode::ArchiveEntryPath,
                    format!(
                        "{} in the tag's tree is not a bundle path: {problem}.",
                        quote_text(path)
                    ),
                    "Point `directory` at the bundle directory, which holds the manifest, `sources/` and `ir/` only.",
                )
                .about(path),
            );
        }

        let fold = bundle_path_fold(path);

        if folded.contains(&fold) {
            return TreeFiles::Refused(
                archive_failure(
                    BundleFailureCode::ArchiveEntryDuplicate,
                    format!(
                        "{} differs only by letter case from another file of the tag's tree.",
                        quote_text(path)
                    ),
                    "Keep one of the two files.",
                )
                .about(path),
            );
        }

        folded.push(fold);
        files.push(TreeFile {
            path: path.to_owned(),
            object: object.to_owned(),
        });

        if files.len() > BUNDLE_ENTRIES_MAX {
            return TreeFiles::Refused(
                archive_failure(
                    BundleFailureCode::ArchiveTooManyEntries,
                    format!(
                        "The tag's bundle directory holds more than {BUNDLE_ENTRIES_MAX} files."
                    ),
                    FIX_TOO_LARGE,
                )
                .expecting(BUNDLE_ENTRIES_MAX.to_string()),
            );
        }
    }

    TreeFiles::Files(files)
}

/// `line.slice(0, -1)`: what the TypeScript reads as the header of a line with no tab.
fn without_last_character(line: &str) -> &str {
    line.char_indices()
        .next_back()
        .and_then(|(last, _)| line.get(..last))
        .unwrap_or("")
}
