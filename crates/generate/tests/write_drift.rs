//! What `check` reports for the writes of a run.

use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use seampact_cli_config::CheckLevel;
use seampact_generate::{GeneratedOutput, find_write_drift, plan_writes};
use seampact_target::GeneratedFile;
use seampact_writer::{HandEditPolicy, commit_generated_write};

type TestResult<Value> = Result<Value, Box<dyn std::error::Error>>;

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
