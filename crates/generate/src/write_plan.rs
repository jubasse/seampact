//! Every write of a run, each checked by the writer before the first one is committed.

use camino::{Utf8Path, Utf8PathBuf};
use seampact_cli_config::{CheckLevel, CliIo, CliProblem, Step};
use seampact_target::{GeneratedFile, Refusal};
use seampact_writer::{
    HandEditPolicy, ManifestRead, PlannedWrite, WritePlanOutcome, plan_generated_write,
    read_manifest,
};

use crate::app_entry_where::app_entry_where;
use crate::not_ported::not_ported_yet;
use crate::refusal_problem::problem_from_refusal;
use crate::{EmittedAppDocument, GenerateError, GeneratedOutput};

/// The writer's owner of a document directory's manifest.
pub const DOCUMENT_OWNER: &str = "openapi";

/// The write of one entry and api, checked.
#[derive(Debug, Clone, PartialEq)]
pub struct EntryWrite {
    /// What the entry generated.
    pub output: GeneratedOutput,
    /// The writer's plan, or its refusals.
    pub check: WritePlanOutcome,
}

/// The documents of one directory, written by one writer call under [`DOCUMENT_OWNER`]; `level`
/// is the strictest `checks.openapi` of the documents planned there.
#[derive(Debug, Clone, PartialEq)]
pub struct DocumentDirectoryWrite {
    /// The directory.
    pub directory: Utf8PathBuf,
    /// The documents written there.
    pub documents: Vec<EmittedAppDocument>,
    /// The writer's plan, or its refusals.
    pub check: WritePlanOutcome,
    /// The level of a drift in this directory.
    pub level: CheckLevel,
}

/// Every write of the run, each checked, nothing written yet.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PlannedWrites {
    /// The entries' writes.
    pub entries: Vec<EntryWrite>,
    /// The document directories' writes.
    pub documents: Vec<DocumentDirectoryWrite>,
}

/// A default document directory an app's config plans no document in: documents seampact wrote
/// there are removed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SweptDirectory {
    /// The directory.
    pub directory: Utf8PathBuf,
    /// The level of a drift in this directory.
    pub level: CheckLevel,
}

/// An entry's write the writer planned.
#[derive(Debug, Clone, PartialEq)]
pub struct CommittableEntryWrite {
    /// What the entry generated.
    pub output: GeneratedOutput,
    /// The planned write.
    pub write: PlannedWrite,
}

/// A document directory's write the writer planned.
#[derive(Debug, Clone, PartialEq)]
pub struct CommittableDocumentWrite {
    /// The directory.
    pub directory: Utf8PathBuf,
    /// The documents written there.
    pub documents: Vec<EmittedAppDocument>,
    /// The planned write.
    pub write: PlannedWrite,
}

/// The writes of a run once every check passed.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CommittableWrites {
    /// The entries' writes.
    pub entries: Vec<CommittableEntryWrite>,
    /// The document directories' writes.
    pub documents: Vec<CommittableDocumentWrite>,
}

/// Checks every write before the first one: each entry's output directory, then each document
/// directory, and each swept directory that holds documents seampact wrote.
///
/// # Errors
///
/// [`GenerateError::NotPortedYet`] until the function is ported.
pub fn plan_writes(
    _outputs: &[GeneratedOutput],
    _documents: &[EmittedAppDocument],
    _swept: &[SweptDirectory],
    _policy: HandEditPolicy,
) -> Result<PlannedWrites, GenerateError> {
    Err(not_ported_yet("planWrites"))
}

/// The writes as planned writes, or every refusal of the run.
///
/// # Errors
///
/// [`GenerateError::NotPortedYet`] until `documentProblem` is ported.
pub fn committable_writes(writes: PlannedWrites) -> Result<Step<CommittableWrites>, GenerateError> {
    let mut problems: Vec<CliProblem> = writes
        .entries
        .iter()
        .flat_map(entry_write_problems)
        .collect();

    for write in &writes.documents {
        problems.extend(document_write_problems(write)?);
    }

    if !problems.is_empty() {
        return Ok(Step::Refused(problems));
    }

    let mut committable = CommittableWrites::default();

    for EntryWrite { output, check } in writes.entries {
        if let WritePlanOutcome::Planned(write) = check {
            committable
                .entries
                .push(CommittableEntryWrite { output, write });
        }
    }

    for DocumentDirectoryWrite {
        directory,
        documents,
        check,
        ..
    } in writes.documents
    {
        if let WritePlanOutcome::Planned(write) = check {
            committable.documents.push(CommittableDocumentWrite {
                directory,
                documents,
                write,
            });
        }
    }

    Ok(Step::Done(committable))
}

/// The problems of an entry's write the writer refused.
fn entry_write_problems(write: &EntryWrite) -> Vec<CliProblem> {
    let WritePlanOutcome::Refused(refusals) = &write.check else {
        return Vec::new();
    };
    let output = &write.output;
    let location = app_entry_where(output.app.as_deref(), &output.entry_id, Some(&output.api));

    refusals
        .iter()
        .map(|refusal| problem_from_refusal(refusal, location.clone(), None))
        .collect()
}

/// The problems of a document directory's write the writer refused.
fn document_write_problems(
    write: &DocumentDirectoryWrite,
) -> Result<Vec<CliProblem>, GenerateError> {
    let WritePlanOutcome::Refused(refusals) = &write.check else {
        return Ok(Vec::new());
    };

    refusals
        .iter()
        .map(|refusal| document_problem(&write.directory, refusal))
        .collect()
}

fn document_problem(
    _directory: &Utf8Path,
    _refusal: &Refusal,
) -> Result<CliProblem, GenerateError> {
    Err(not_ported_yet("documentProblem"))
}

/// The writer's plan for `files` in `directory`, or its refusals.
///
/// # Errors
///
/// [`GenerateError::Io`] or [`GenerateError::Internal`] when the writer cannot check.
#[expect(dead_code, reason = "called by plan_writes, brief 2")]
fn check_write(
    directory: &Utf8Path,
    owner: &str,
    files: &[GeneratedFile],
    policy: HandEditPolicy,
) -> Result<WritePlanOutcome, GenerateError> {
    Ok(plan_generated_write(directory, owner, files, policy)?)
}

/// Whether `directory` holds a manifest of documents seampact wrote.
#[expect(dead_code, reason = "called by plan_writes, brief 2")]
fn holds_written_documents(directory: &Utf8Path) -> Result<bool, GenerateError> {
    let manifest = read_manifest(directory)?;

    Ok(matches!(
        manifest,
        ManifestRead::Read { owner: Some(owner), .. } if owner == DOCUMENT_OWNER
    ))
}

/// Commits every write: each entry's files, then each document directory, printing what each
/// wrote and its warnings.
///
/// # Errors
///
/// [`GenerateError::NotPortedYet`] until the function is ported.
pub fn commit_writes(_writes: CommittableWrites, _io: &mut dyn CliIo) -> Result<(), GenerateError> {
    Err(not_ported_yet("commitWrites"))
}
