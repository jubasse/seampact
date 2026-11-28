//! What `check` finds when the files a run would write differ from the committed ones.

use std::collections::HashSet;

use camino::Utf8Path;
use seampact_cli_config::{CheckLevel, CliProblem, located_problem};
use seampact_openapi::find_document_drift;
use seampact_target::{Refusal, Refused, refusal_code};
use seampact_writer::{PlannedWrite, read_file_if_present};

use crate::GenerateError;
use crate::app_entry_where::app_entry_where;
use crate::write_plan::PlannedWrites;

/// A drift at `error` fails, at `warning` is reported, `disabled` is not looked for.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WriteDrift {
    /// A drift of a check at `error`, or a refusal that is not a drift.
    pub errors: Vec<CliProblem>,
    /// A drift of a check at `warning`.
    pub warnings: Vec<CliProblem>,
}

/// The refusals that mean the committed files were edited by hand, which is a drift.
const HAND_EDIT_CODES: [&str; 2] = [
    refusal_code::WRITER_FILE_EDITED,
    refusal_code::WRITER_FILE_NOT_GENERATED,
];

/// What one kind of write reports when it drifts.
struct DriftKind {
    level: CheckLevel,
    code: &'static str,
    subject: String,
    fix: &'static str,
    location: String,
}

/// What a write drifted in, or the refusals that are not a drift.
enum DriftItems<'check> {
    Listed {
        items: Vec<String>,
        fix: Option<&'check str>,
    },
    Unreadable(Vec<&'check Refusal>),
}

/// Compares every planned write with the files on disk.
///
/// # Errors
///
/// [`GenerateError::Io`] when a committed file exists and cannot be read.
pub fn find_write_drift(writes: &PlannedWrites) -> Result<WriteDrift, GenerateError> {
    let mut drift = WriteDrift::default();

    for write in &writes.entries {
        let output = &write.output;
        let location = app_entry_where(output.app.as_deref(), &output.entry_id, Some(&output.api));

        add_drift(
            &mut drift,
            &write.check,
            DriftKind {
                level: output.level,
                code: "check.generated.drift",
                subject: format!("The generated files of {location}"),
                fix: "Run `seampact generate` and commit the result, or set `checks.generated` to `warning` or `disabled` in the app config.",
                location,
            },
        )?;
    }

    for write in &writes.documents {
        let directory = &write.directory;

        add_drift(
            &mut drift,
            &write.check,
            DriftKind {
                level: write.level,
                code: "check.openapi.drift",
                subject: format!("The seampact OpenAPI documents in {directory}"),
                fix: "Run `seampact generate` and commit the result, or set `checks.openapi` to `warning` or `disabled` in the config that writes them.",
                location: format!("openapi documents in {directory}"),
            },
        )?;
    }

    Ok(drift)
}

fn add_drift(
    drift: &mut WriteDrift,
    check: &Result<PlannedWrite, Refused>,
    kind: DriftKind,
) -> Result<(), GenerateError> {
    let (items, fix) = match drift_items(check)? {
        DriftItems::Unreadable(refusals) => {
            drift.errors.extend(
                refusals
                    .into_iter()
                    .map(|refusal| refusal_problem(refusal, &kind.location)),
            );

            return Ok(());
        }
        DriftItems::Listed { items, fix } => (items, fix),
    };

    // A disabled level looks for no drift, but a directory `generate` refuses is refused here too.
    if kind.level == CheckLevel::Disabled || items.is_empty() {
        return Ok(());
    }

    let problem = located_problem(
        kind.code,
        format!(
            "{} differ from the committed files: {}.",
            kind.subject,
            items.join("; ")
        ),
        fix.unwrap_or(kind.fix),
        kind.location,
    );

    if kind.level == CheckLevel::Error {
        drift.errors.push(problem);
    } else {
        drift.warnings.push(problem);
    }

    Ok(())
}

fn drift_items(check: &Result<PlannedWrite, Refused>) -> Result<DriftItems<'_>, GenerateError> {
    let refusals = match check {
        Ok(write) => {
            return Ok(DriftItems::Listed {
                items: planned_drift(write)?,
                fix: None,
            });
        }
        Err(Refused(refusals)) => refusals,
    };
    let other: Vec<&Refusal> = refusals
        .iter()
        .filter(|refusal| !HAND_EDIT_CODES.contains(&refusal.code.as_str()))
        .collect();

    if !other.is_empty() {
        return Ok(DriftItems::Unreadable(other));
    }

    Ok(DriftItems::Listed {
        items: refusals
            .iter()
            .map(|refusal| refusal.message.trim_end_matches('.').to_owned())
            .collect(),
        fix: refusals.first().map(|refusal| refusal.fix.as_str()),
    })
}

fn refusal_problem(refusal: &Refusal, location: &str) -> CliProblem {
    located_problem(
        &refusal.code,
        refusal.message.clone(),
        &refusal.fix,
        location.to_owned(),
    )
}

/// The files a planned write would change, each with how it differs, then the stale ones.
fn planned_drift(write: &PlannedWrite) -> Result<Vec<String>, GenerateError> {
    let mut items = Vec::new();

    let unchanged: HashSet<&str> = write.unchanged().iter().map(String::as_str).collect();

    for (path, bytes) in write.files() {
        if unchanged.contains(path) {
            continue;
        }

        let location = write.root_directory().join(path);

        items.push(file_drift(
            &location,
            path,
            &String::from_utf8_lossy(bytes),
        )?);
    }

    for path in write.removable() {
        items.push(format!(
            "{path} (stale: generated earlier, no longer produced)"
        ));
    }

    Ok(items)
}

fn file_drift(location: &Utf8Path, path: &str, generated: &str) -> Result<String, GenerateError> {
    let Some(committed) = read_file_if_present(location)? else {
        return Ok(format!("{path} (missing)"));
    };

    Ok(match find_document_drift(&committed, generated) {
        None => format!("{path} (differs)"),
        Some(drift) => format!("{path} (differs at line {})", drift.line),
    })
}
