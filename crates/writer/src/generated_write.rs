//! The write of a target's files into its output directory: planned with every check first, then
//! committed, so a run checks every directory before its first write.

use std::collections::{HashMap, HashSet};
use std::fs;

use camino::{Utf8Path, Utf8PathBuf};
use seampact_paths::case_folded;
use seampact_paths::node_path::resolve_from_working_directory;
use seampact_target::{GeneratedFile, Refusal, Refused, refusal_code};

use crate::existing_file::{ExistingFileState, existing_file_state};
use crate::generated_paths::MANIFEST_FILE_NAME;
use crate::manifest::{ManifestEntry, ManifestRead, read_manifest, serialize_manifest};
use crate::root_directory::{real_path_of_missing, remove_empty_directories};
use crate::sha256::sha256_hex;
use crate::{HandEditPolicy, WriteStop, WriterError, check_generated_paths, lstat_if_present};

const BYTE_ORDER_MARK: char = '\u{feff}';

/// What a committed write did, each list a path relative to the output directory.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub struct WrittenFiles {
    /// The files whose bytes changed.
    pub written: Vec<String>,
    /// The files already holding these bytes.
    pub unchanged: Vec<String>,
    /// The files an earlier write generated and this one does not.
    pub removed: Vec<String>,
}

/// A write whose checks all passed, nothing written yet: what [`commit_generated_write`] writes,
/// keeps and removes. It owns its paths and bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedWrite {
    root_directory: Utf8PathBuf,
    owner: String,
    files: Vec<PlannedFile>,
    unchanged: Vec<String>,
    removable: Vec<String>,
}

/// One file of a planned write: its path, its final bytes and their SHA-256.
#[derive(Debug, Clone, PartialEq, Eq)]
struct PlannedFile {
    path: String,
    bytes: Vec<u8>,
    sha256: String,
}

/// Plans then commits the write of `files` into `out_directory` under `owner`.
///
/// # Errors
///
/// [`WriteStop::Refused`] when a check refuses, nothing written; [`WriteStop::Failed`] when a
/// file or directory cannot be read or written.
pub fn write_generated_files(
    out_directory: &Utf8Path,
    owner: &str,
    files: Vec<GeneratedFile>,
    policy: HandEditPolicy,
) -> Result<WrittenFiles, WriteStop> {
    let write = plan_generated_write(out_directory, owner, files, policy)?;

    Ok(commit_generated_write(write)?)
}

/// Every check of a write with nothing written: the manifest, unsafe and duplicate paths, files the
/// writer did not generate, hand edits and paths leaving `out_directory`.
///
/// # Errors
///
/// [`WriteStop::Refused`] with every refusal of the checks; [`WriteStop::Failed`] when a file or
/// directory cannot be read.
pub fn plan_generated_write(
    out_directory: &Utf8Path,
    owner: &str,
    files: Vec<GeneratedFile>,
    policy: HandEditPolicy,
) -> Result<PlannedWrite, WriteStop> {
    let checked = check_generated_paths(files)?;

    let root_directory = real_path_of_missing(
        &resolve_from_working_directory(out_directory)
            .map_err(|error| WriterError::io(out_directory, &error))?,
    )?;

    if let Some(refusal) = manifest_file_refusal(&root_directory)? {
        return Err(Refused(vec![refusal]).into());
    }

    let recorded = match read_manifest(&root_directory)? {
        ManifestRead::Invalid { reason } => {
            return Err(refused_one(
                refusal_code::WRITER_MANIFEST_INVALID,
                format!(
                    "The manifest {} cannot be read: {reason}.",
                    root_directory.join(MANIFEST_FILE_NAME)
                ),
                "Delete the generated files of this target and its manifest, then generate again.",
            ));
        }
        ManifestRead::Read {
            owner: recorded_owner,
            entries,
        } => {
            if let Some(other) = recorded_owner.filter(|recorded_owner| recorded_owner != owner) {
                return Err(refused_one(
                    refusal_code::WRITER_MANIFEST_OTHER_OWNER,
                    format!(
                        "The output directory {root_directory} belongs to the target '{other}', not '{owner}'."
                    ),
                    format!(
                        "Give '{owner}' its own `out` directory, or delete {} and the files of '{other}'.",
                        root_directory.join(MANIFEST_FILE_NAME)
                    ),
                ));
            }

            entries
        }
    };

    let planned: Vec<PlannedFile> = checked.into_iter().map(planned_file).collect();
    let Classified {
        refusals,
        unchanged,
        removable,
    } = classify_files(&root_directory, &planned, &recorded, policy)?;

    if !refusals.is_empty() {
        return Err(Refused(refusals).into());
    }

    Ok(PlannedWrite {
        root_directory,
        owner: owner.to_owned(),
        files: planned,
        unchanged,
        removable,
    })
}

fn refused_one(code: &str, message: String, fix: impl Into<String>) -> WriteStop {
    Refused(vec![Refusal::new(code, message, fix)]).into()
}

/// What the planned and the stale files of a write turned out to be.
struct Classified {
    refusals: Vec<Refusal>,
    unchanged: Vec<String>,
    removable: Vec<String>,
}

fn classify_files(
    root_directory: &Utf8Path,
    planned: &[PlannedFile],
    recorded: &[ManifestEntry],
    policy: HandEditPolicy,
) -> Result<Classified, WriterError> {
    let produced: HashSet<&str> = planned.iter().map(|file| file.path.as_str()).collect();
    let recorded_sha256: HashMap<&str, &str> = recorded
        .iter()
        .map(|entry| (entry.path.as_str(), entry.sha256.as_str()))
        .collect();
    let stale_paths: Vec<&str> = recorded
        .iter()
        .map(|entry| entry.path.as_str())
        .filter(|path| !produced.contains(path))
        .collect();
    let stale_by_folded_path: HashMap<String, &str> = stale_paths
        .iter()
        .map(|path| (case_folded(path), *path))
        .collect();
    let mut classified = Classified {
        refusals: Vec::new(),
        unchanged: Vec::new(),
        removable: Vec::new(),
    };

    for file in planned {
        let state = existing_file_state(
            root_directory,
            &file.path,
            recorded_sha256.get(file.path.as_str()).copied(),
            policy,
            stale_by_folded_path.get(&case_folded(&file.path)).copied(),
        )?;

        match state {
            ExistingFileState::Refused(refusal) => classified.refusals.push(refusal),
            ExistingFileState::Generated { sha256 } if sha256 == file.sha256 => {
                classified.unchanged.push(file.path.clone());
            }
            ExistingFileState::Generated { .. } | ExistingFileState::Absent => {}
        }
    }

    for path in stale_paths {
        let state = existing_file_state(
            root_directory,
            path,
            recorded_sha256.get(path).copied(),
            policy,
            None,
        )?;

        match state {
            ExistingFileState::Refused(refusal) => classified.refusals.push(refusal),
            ExistingFileState::Generated { .. } => classified.removable.push(path.to_owned()),
            ExistingFileState::Absent => {}
        }
    }

    Ok(classified)
}

/// A refusal when the manifest path exists and is not a regular file.
fn manifest_file_refusal(root_directory: &Utf8Path) -> Result<Option<Refusal>, WriterError> {
    let manifest_path = root_directory.join(MANIFEST_FILE_NAME);

    let Some(metadata) = lstat_if_present(&manifest_path)? else {
        return Ok(None);
    };

    if metadata.is_file() {
        return Ok(None);
    }

    Ok(Some(Refusal::new(
        refusal_code::WRITER_MANIFEST_NOT_REGULAR,
        format!(
            "The manifest {manifest_path} is not a regular file, so the writer does not read or write it."
        ),
        format!("Delete {manifest_path}, then generate again."),
    )))
}

/// The bytes a file is written with: no byte order mark, LF line endings, one final newline.
fn planned_file(file: GeneratedFile) -> PlannedFile {
    let without_mark = file
        .contents
        .strip_prefix(BYTE_ORDER_MARK)
        .unwrap_or(&file.contents);
    let mut text = without_mark.replace("\r\n", "\n").replace('\r', "\n");

    if !text.ends_with('\n') {
        text.push('\n');
    }

    let bytes = text.into_bytes();

    PlannedFile {
        path: file.path,
        sha256: sha256_hex(&bytes),
        bytes,
    }
}

/// Writes a planned write: the changed files, the removal of the stale ones, then the manifest.
///
/// # Errors
///
/// [`WriterError::Io`] when a file or directory cannot be written or removed.
pub fn commit_generated_write(write: PlannedWrite) -> Result<WrittenFiles, WriterError> {
    let PlannedWrite {
        root_directory,
        owner,
        files,
        unchanged,
        removable,
    } = write;

    create_directories(&root_directory)?;

    let unchanged_paths: HashSet<&str> = unchanged.iter().map(String::as_str).collect();
    let to_write: Vec<&PlannedFile> = files
        .iter()
        .filter(|file| !unchanged_paths.contains(file.path.as_str()))
        .collect();

    for file in &to_write {
        let file_path = root_directory.join(&file.path);

        if let Some(directory) = file_path.parent() {
            create_directories(directory)?;
        }

        fs::write(&file_path, &file.bytes).map_err(|error| WriterError::io(&file_path, &error))?;
    }

    for path in &removable {
        let file_path = root_directory.join(path);

        fs::remove_file(&file_path).map_err(|error| WriterError::io(&file_path, &error))?;

        if let Some(directory) = file_path.parent() {
            remove_empty_directories(&root_directory, directory)?;
        }
    }

    let entries: Vec<ManifestEntry> = files
        .iter()
        .map(|file| ManifestEntry {
            path: file.path.clone(),
            source: file.sha256.clone(),
            sha256: file.sha256.clone(),
            formatter: None,
        })
        .collect();
    let manifest_path = root_directory.join(MANIFEST_FILE_NAME);

    fs::write(&manifest_path, serialize_manifest(&owner, &entries))
        .map_err(|error| WriterError::io(&manifest_path, &error))?;

    Ok(WrittenFiles {
        written: to_write.iter().map(|file| file.path.clone()).collect(),
        unchanged,
        removed: removable,
    })
}

fn create_directories(directory: &Utf8Path) -> Result<(), WriterError> {
    fs::create_dir_all(directory).map_err(|error| WriterError::io(directory, &error))
}
