//! Every write of a run, each checked by the writer before the first one is committed.

use camino::Utf8PathBuf;
use seampact_cli_config::{CheckLevel, Step};
use seampact_writer::{HandEditPolicy, PlannedWrite, WritePlanOutcome};

use crate::not_ported::not_ported_yet;
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
/// [`GenerateError::NotPortedYet`] until the function is ported.
pub fn committable_writes(
    _writes: PlannedWrites,
) -> Result<Step<CommittableWrites>, GenerateError> {
    Err(not_ported_yet("committableWrites"))
}
