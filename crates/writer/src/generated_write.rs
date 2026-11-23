//! The write of a target's files into its output directory: planned with every check first, then
//! committed, so a run checks every directory before its first write.

use camino::{Utf8Path, Utf8PathBuf};
use seampact_target::{GeneratedFile, Refusal};

use crate::not_ported::not_ported_yet;
use crate::{HandEditPolicy, WriterError};

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

/// A planned write, or the refusals of its checks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WritePlanOutcome {
    /// Every check passed.
    Planned(PlannedWrite),
    /// The write is refused, naming each file and the fix.
    Refused(Vec<Refusal>),
}

/// What [`write_generated_files`] answers: the files written, or the refusals.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteOutcome {
    /// The write was committed.
    Written(WrittenFiles),
    /// The write is refused, nothing written.
    Refused(Vec<Refusal>),
}

/// Plans then commits the write of `files` into `out_directory` under `owner`.
///
/// # Errors
///
/// [`WriterError::NotPortedYet`] until the function is ported.
pub fn write_generated_files(
    _out_directory: &Utf8Path,
    _owner: &str,
    _files: &[GeneratedFile],
    _policy: HandEditPolicy,
) -> Result<WriteOutcome, WriterError> {
    Err(not_ported_yet("writeGeneratedFiles"))
}

/// Every check of a write with nothing written: the manifest, unsafe and duplicate paths, files the
/// writer did not generate, hand edits and paths leaving `out_directory`.
///
/// # Errors
///
/// [`WriterError::NotPortedYet`] until the function is ported.
pub fn plan_generated_write(
    _out_directory: &Utf8Path,
    _owner: &str,
    _files: &[GeneratedFile],
    _policy: HandEditPolicy,
) -> Result<WritePlanOutcome, WriterError> {
    Err(not_ported_yet("planGeneratedWrite"))
}

/// Writes a planned write: the changed files, the removal of the stale ones, then the manifest.
///
/// # Errors
///
/// [`WriterError::NotPortedYet`] until the function is ported.
pub fn commit_generated_write(_write: PlannedWrite) -> Result<WrittenFiles, WriterError> {
    Err(not_ported_yet("commitGeneratedWrite"))
}
