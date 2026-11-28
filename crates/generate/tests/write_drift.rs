//! What `check` reports for a write the writer refuses because the committed files were edited.

use std::fs;

use camino::Utf8PathBuf;
use seampact_cli_config::CheckLevel;
use seampact_generate::{EmittedAppDocument, find_write_drift, plan_writes};
use seampact_writer::HandEditPolicy;

type TestResult<Value> = Result<Value, Box<dyn std::error::Error>>;

fn drift_at(level: CheckLevel) -> TestResult<(Utf8PathBuf, seampact_generate::WriteDrift)> {
    let temporary = tempfile::tempdir()?;
    let directory = Utf8PathBuf::from_path_buf(temporary.path().join("docs"))
        .map_err(|path| format!("not UTF-8: {}", path.display()))?;
    let file = directory.join("tasks.yaml");

    fs::create_dir_all(&directory)?;
    fs::write(&file, "mine: true\n")?;

    let document = EmittedAppDocument {
        name: "tasks".to_owned(),
        file,
        text: "openapi: 3.1.0\n".to_owned(),
        level,
    };
    let planned = plan_writes(Vec::new(), &[document], &[], HandEditPolicy::Refuse)?;

    // The temporary directory outlives the call: the plan holds no handle on it.
    Ok((directory, find_write_drift(&planned)?))
}

#[test]
fn a_hand_edited_document_is_a_drift_at_the_level_of_its_directory() -> TestResult<()> {
    let (directory, warning_level) = drift_at(CheckLevel::Warning)?;
    let (_, error_level) = drift_at(CheckLevel::Error)?;
    let (_, disabled_level) = drift_at(CheckLevel::Disabled)?;

    assert_eq!(
        warning_level.errors,
        [] as [seampact_cli_config::CliProblem; 0]
    );
    assert_eq!(
        error_level.warnings,
        [] as [seampact_cli_config::CliProblem; 0]
    );
    assert!(disabled_level.errors.is_empty() && disabled_level.warnings.is_empty());

    let [problem] = warning_level.warnings.as_slice() else {
        return Err(format!("warnings: {:?}", warning_level.warnings).into());
    };

    assert_eq!(problem.code, "check.openapi.drift");
    assert_eq!(
        problem.location.as_deref(),
        Some(format!("openapi documents in {}", directory.as_str()).as_str())
    );
    assert!(
        problem
            .message
            .starts_with("The seampact OpenAPI documents in "),
        "message: {}",
        problem.message
    );
    assert!(
        problem.message.ends_with('.') && !problem.message.ends_with(".."),
        "message: {}",
        problem.message
    );
    assert_eq!(error_level.errors.len(), 1);

    Ok(())
}

#[test]
fn a_document_not_yet_committed_is_listed_as_missing() -> TestResult<()> {
    let temporary = tempfile::tempdir()?;
    let directory = Utf8PathBuf::from_path_buf(temporary.path().join("docs"))
        .map_err(|path| format!("not UTF-8: {}", path.display()))?;
    let document = EmittedAppDocument {
        name: "tasks".to_owned(),
        file: directory.join("tasks.yaml"),
        text: "openapi: 3.1.0\n".to_owned(),
        level: CheckLevel::Error,
    };
    let planned = plan_writes(Vec::new(), &[document], &[], HandEditPolicy::Refuse)?;
    let drift = find_write_drift(&planned)?;

    let [problem] = drift.errors.as_slice() else {
        return Err(format!("errors: {:?}", drift.errors).into());
    };

    assert!(
        problem.message.contains("tasks.yaml (missing)"),
        "{}",
        problem.message
    );

    Ok(())
}
