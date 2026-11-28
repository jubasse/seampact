//! Every write of a run, each checked by the writer before the first one is committed.

use std::mem;

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_cli_config::{
    CheckLevel, CliIo, CliProblem, Problems, located_problem, print_warnings,
};
use seampact_paths::node_path;
use seampact_target::{GenerateWarning, GeneratedFile, Refusal, Refused, refusal_code};
use seampact_writer::{
    HandEditPolicy, ManifestRead, PlannedWrite, WriteStop, commit_generated_write,
    plan_generated_write, read_manifest,
};

use crate::app_entry_where::app_entry_where;
use crate::drift_level::strictest_level;
use crate::refusal_problem::problem_from_refusal;
use crate::stop::Stop;
use crate::{EmittedAppDocument, GenerateError, GeneratedOutput};

/// The writer's owner of a document directory's manifest.
pub const DOCUMENT_OWNER: &str = "openapi";

/// The write of one entry and api, checked.
#[derive(Debug, Clone, PartialEq)]
pub struct EntryWrite {
    /// What the entry generated.
    pub output: GeneratedOutput,
    /// The writer's plan, or its refusals.
    pub check: Result<PlannedWrite, Refused>,
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
    pub check: Result<PlannedWrite, Refused>,
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
/// [`GenerateError::Io`] or [`GenerateError::Internal`] when the writer cannot check.
pub fn plan_writes(
    outputs: Vec<GeneratedOutput>,
    documents: &[EmittedAppDocument],
    swept: &[SweptDirectory],
    policy: HandEditPolicy,
) -> Result<PlannedWrites, GenerateError> {
    let mut planned = PlannedWrites::default();

    for mut output in outputs {
        // The files move into the writer's plan, which holds them from here on.
        let files = mem::take(&mut output.files);
        let check = match plan_generated_write(&output.root, &output.entry_id, files, policy) {
            Ok(write) => Ok(write),
            Err(stop) => Err(refused_of(stop)?),
        };

        planned.entries.push(EntryWrite { output, check });
    }

    for (directory, group) in document_directories(documents, swept)? {
        let files: Vec<GeneratedFile> = group
            .documents
            .iter()
            .map(|document| GeneratedFile {
                path: document.file.file_name().unwrap_or_default().to_owned(),
                contents: document.text.clone(),
            })
            .collect();
        let check = match plan_generated_write(&directory, DOCUMENT_OWNER, files, policy) {
            Ok(write) => Ok(write),
            Err(stop) => Err(refused_of(stop)?),
        };

        planned.documents.push(DocumentDirectoryWrite {
            directory,
            documents: group.documents,
            check,
            level: group.level,
        });
    }

    Ok(planned)
}

/// The documents written to one directory, and the level of a drift there.
struct DocumentGroup {
    documents: Vec<EmittedAppDocument>,
    level: CheckLevel,
}

/// The documents grouped by directory in first-seen order, then each swept directory that holds
/// documents seampact wrote and no planned document.
fn document_directories(
    documents: &[EmittedAppDocument],
    swept: &[SweptDirectory],
) -> Result<IndexMap<Utf8PathBuf, DocumentGroup>, GenerateError> {
    let mut by_directory: IndexMap<Utf8PathBuf, Vec<EmittedAppDocument>> = IndexMap::new();

    for document in documents {
        by_directory
            .entry(node_path::dirname(&document.file))
            .or_default()
            .push(document.clone());
    }

    let mut groups: IndexMap<Utf8PathBuf, DocumentGroup> = by_directory
        .into_iter()
        .map(|(directory, group)| {
            let levels: Vec<CheckLevel> = group.iter().map(|document| document.level).collect();

            let level = strictest_level(&levels);

            (
                directory,
                DocumentGroup {
                    documents: group,
                    level,
                },
            )
        })
        .collect();

    for SweptDirectory { directory, level } in swept {
        if !groups.contains_key(directory) && holds_written_documents(directory)? {
            groups.insert(
                directory.clone(),
                DocumentGroup {
                    documents: Vec::new(),
                    level: *level,
                },
            );
        }
    }

    Ok(groups)
}

/// The writes as planned writes, or every refusal of the run.
///
/// # Errors
///
/// [`Stop::Refused`] with every refusal of the run.
pub fn committable_writes(writes: PlannedWrites) -> Result<CommittableWrites, Stop> {
    let mut problems: Vec<CliProblem> = writes
        .entries
        .iter()
        .flat_map(entry_write_problems)
        .collect();

    problems.extend(writes.documents.iter().flat_map(document_write_problems));

    Problems::refuse_any(problems)?;

    let mut committable = CommittableWrites::default();

    for EntryWrite { output, check } in writes.entries {
        if let Ok(write) = check {
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
        if let Ok(write) = check {
            committable.documents.push(CommittableDocumentWrite {
                directory,
                documents,
                write,
            });
        }
    }

    Ok(committable)
}

/// The problems of an entry's write the writer refused.
fn entry_write_problems(write: &EntryWrite) -> Vec<CliProblem> {
    let Err(Refused(refusals)) = &write.check else {
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
fn document_write_problems(write: &DocumentDirectoryWrite) -> Vec<CliProblem> {
    let Err(Refused(refusals)) = &write.check else {
        return Vec::new();
    };

    refusals
        .iter()
        .map(|refusal| document_problem(&write.directory, refusal))
        .collect()
}

fn document_problem(directory: &Utf8Path, refusal: &Refusal) -> CliProblem {
    let location = format!("openapi documents in {directory}");

    match refusal.code.as_str() {
        refusal_code::WRITER_FILE_NOT_GENERATED => located_problem(
            "openapi.document.not-generated",
            refusal.message.clone(),
            "Move or rename that file, write `openapi: none` in the app config to write no seampact document, or give the document another path in `openapi`.",
            location,
        ),
        refusal_code::WRITER_FILE_EDITED => located_problem(
            "openapi.document.edited",
            refusal.message.clone(),
            "Delete the edited document so that `generate` writes it again, run `seampact generate --force` to write it over the edit, or give the document another path in `openapi`.",
            location,
        ),
        _ => problem_from_refusal(refusal, location, None),
    }
}

/// The refusals the run reports with the others.
///
/// # Errors
///
/// [`GenerateError::Io`] or [`GenerateError::Internal`] when the writer could not check.
fn refused_of(stop: WriteStop) -> Result<Refused, GenerateError> {
    match stop {
        WriteStop::Refused(refused) => Ok(refused),
        WriteStop::Failed(error) => Err(error.into()),
    }
}

/// Whether `directory` holds a manifest of documents seampact wrote.
fn holds_written_documents(directory: &Utf8Path) -> Result<bool, GenerateError> {
    let manifest = read_manifest(directory)?;

    Ok(matches!(
        manifest,
        ManifestRead::Read { owner: Some(owner), .. } if owner == DOCUMENT_OWNER
    ))
}

/// A warning printed as a refusal is: its code, message, fix, operation and IR member.
fn warning_problem(warning: &GenerateWarning, location: &str) -> CliProblem {
    let refusal = Refusal::new(&warning.code, &warning.message, &warning.fix)
        .with_operation(warning.operation.clone());
    let refusal = match &warning.member {
        Some(member) => refusal.with_member(member),
        None => refusal,
    };

    problem_from_refusal(&refusal, location.to_owned(), None)
}

/// Commits every write: each entry's files, then each document directory, printing what each
/// wrote and its warnings.
///
/// # Errors
///
/// [`GenerateError::Io`] or [`GenerateError::Internal`] when a file cannot be written.
pub fn commit_writes(writes: CommittableWrites, io: &mut dyn CliIo) -> Result<(), GenerateError> {
    for CommittableEntryWrite { output, write } in writes.entries {
        let written = commit_generated_write(write)?;
        let location = app_entry_where(output.app.as_deref(), &output.entry_id, Some(&output.api));

        io.stdout(&format!(
            "{location}: {} written, {} unchanged, {} removed ({}).\n",
            written.written.len(),
            written.unchanged.len(),
            written.removed.len(),
            output.root
        ));

        let warnings: Vec<CliProblem> = output
            .warnings
            .iter()
            .map(|warning| warning_problem(warning, &location))
            .collect();

        print_warnings(io, &warnings);
    }

    for CommittableDocumentWrite {
        directory,
        documents,
        write,
    } in writes.documents
    {
        let written = commit_generated_write(write)?;

        for document in &documents {
            let state = if document
                .file
                .file_name()
                .is_some_and(|name| written.written.iter().any(|each| each == name))
            {
                "written"
            } else {
                "unchanged"
            };

            io.stdout(&format!(
                "openapi document '{}': {state} ({}).\n",
                document.name, document.file
            ));
        }

        for removed in &written.removed {
            io.stdout(&format!(
                "openapi document {}: removed.\n",
                node_path::join(&directory, Utf8Path::new(removed))
            ));
        }
    }

    Ok(())
}
