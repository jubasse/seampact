//! What is already at a path the writer is about to write or remove.

use camino::Utf8Path;
use seampact_target::{Refusal, refusal_code};

use crate::file_presence::lstat_entry;
use crate::root_directory::leaves_root;
use crate::sha256::sha256_hex_of_file;
use crate::{HandEditPolicy, WriterError};

const HAND_EDIT_FIX: &str = "Move the hand-written code next to the generated files, then delete the edited file and generate again, or run `seampact generate --force` to overwrite it.";

/// What the writer found at a path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ExistingFileState {
    /// Nothing there.
    Absent,
    /// The writer may overwrite or remove it; the SHA-256 of its bytes.
    Generated { sha256: String },
    /// The write is refused.
    Refused(Refusal),
}

/// What the writer found at `path` below `root`, given the SHA-256 the manifest recorded for it.
///
/// `case_renamed_from` is the path of the previous run that differs from `path` only by letter case.
pub(crate) fn existing_file_state(
    root: &Utf8Path,
    path: &str,
    recorded_sha256: Option<&str>,
    policy: HandEditPolicy,
    case_renamed_from: Option<&str>,
) -> Result<ExistingFileState, WriterError> {
    let file_path = root.join(path);

    if leaves_root(root, &file_path)? {
        return Ok(refused(
            refusal_code::WRITER_PATH_OUTSIDE,
            format!(
                "'{file_path}' resolves outside the output directory {root} through a symbolic link."
            ),
            "Replace the symbolic link in the output directory with a plain directory.".to_owned(),
        ));
    }

    let Some(metadata) = lstat_entry(&file_path)? else {
        return Ok(ExistingFileState::Absent);
    };

    if !metadata.is_file() {
        return Ok(refused(
            refusal_code::WRITER_FILE_NOT_GENERATED,
            format!("'{file_path}' is not a regular file, so the writer did not generate it."),
            format!("Move it out of the output directory {root}."),
        ));
    }

    let Some(recorded) = recorded_sha256 else {
        return Ok(unrecorded_file_refusal(root, &file_path, case_renamed_from));
    };

    let sha256 =
        sha256_hex_of_file(&file_path).map_err(|error| WriterError::io(&file_path, &error))?;

    if sha256 != recorded && policy == HandEditPolicy::Refuse {
        return Ok(refused(
            refusal_code::WRITER_FILE_EDITED,
            format!(
                "'{file_path}' was edited by hand since it was generated, so it is not overwritten or removed."
            ),
            HAND_EDIT_FIX.to_owned(),
        ));
    }

    Ok(ExistingFileState::Generated { sha256 })
}

fn unrecorded_file_refusal(
    root: &Utf8Path,
    file_path: &Utf8Path,
    case_renamed_from: Option<&str>,
) -> ExistingFileState {
    if let Some(earlier) = case_renamed_from {
        return refused(
            refusal_code::WRITER_FILE_NOT_GENERATED,
            format!(
                "'{file_path}' exists, and the previous run generated '{earlier}', so this run renames it only by letter case; on a case-insensitive file system they are one file."
            ),
            format!("Delete '{}', then generate again.", root.join(earlier)),
        );
    }

    refused(
        refusal_code::WRITER_FILE_NOT_GENERATED,
        format!(
            "'{file_path}' exists and the writer did not generate it, so it is not overwritten."
        ),
        format!("Move it out of the output directory {root}, or rename it."),
    )
}

fn refused(code: &str, message: String, fix: String) -> ExistingFileState {
    ExistingFileState::Refused(Refusal::new(code, message, fix))
}
