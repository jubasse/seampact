//! What `check` reports for a write the writer refuses because the committed files were edited.

use std::fs;

use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use seampact_cli_config::CheckLevel;
use seampact_generate::{EmittedAppDocument, GeneratedOutput, find_write_drift, plan_writes};
use seampact_target::GeneratedFile;
use seampact_writer::{HandEditPolicy, commit_generated_write};

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

const MANY_FILES: usize = 20_000;
// Past about 28,000 files the writer refuses the manifest as too large.
const DRIFT_TIME_LIMIT: Duration = Duration::from_millis(200);

fn many_files_output(root: &Utf8PathBuf, changed: bool) -> GeneratedOutput {
    let files: Vec<GeneratedFile> = (0..MANY_FILES)
        .map(|index| GeneratedFile {
            path: format!("f{index}.json"),
            contents: if changed && index == 0 {
                "{\"changed\":true}".to_owned()
            } else {
                "{}".to_owned()
            },
        })
        .collect();

    GeneratedOutput {
        entry_id: "api".to_owned(),
        api: "tasks".to_owned(),
        root: root.clone(),
        files,
        warnings: Vec::new(),
        level: CheckLevel::Error,
        app: None,
    }
}

#[test]
fn a_drift_among_many_unchanged_files_is_found_in_linear_time() -> TestResult<()> {
    let temporary = tempfile::tempdir()?;
    let root = Utf8PathBuf::from_path_buf(temporary.path().join("out"))
        .map_err(|path| format!("not UTF-8: {}", path.display()))?;
    let first = plan_writes(
        vec![many_files_output(&root, false)],
        &[],
        &[],
        HandEditPolicy::Refuse,
    )?;

    for entry in first.entries {
        commit_generated_write(entry.check.map_err(|refused| format!("{refused:?}"))?)?;
    }

    let second = plan_writes(
        vec![many_files_output(&root, true)],
        &[],
        &[],
        HandEditPolicy::Refuse,
    )?;
    let started = Instant::now();
    let drift = find_write_drift(&second)?;
    let elapsed = started.elapsed();

    assert_eq!(drift.errors.len(), 1, "errors: {}", drift.errors.len());
    assert!(
        elapsed < DRIFT_TIME_LIMIT,
        "{MANY_FILES} unchanged files took {elapsed:?}"
    );

    Ok(())
}
