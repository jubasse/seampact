//! `seampact generate` and `seampact check` on an app that lists one OpenAPI document and no
//! target: the commands the oracle cases also run, here with their exit codes and messages read
//! from the real binary entry.

use std::fs;

use camino::Utf8Path;
use seampact_cli::{EXIT_REFUSED, EXIT_SUCCESS};

mod common;

use common::{TestResult, empty_directory, run};

const CONFIG: &str = "sources:\n  a: { path: ./a }\nopenapi:\n  tasks: { path: docs/tasks.yaml }\n";

const API: &str = "api:\n  name: tasks\n  version: 1\n  kind: product\n  maturity: provisional\n  summary: A small tasks api.\n";

const DOCUMENT: &str = "docs/tasks.yaml";

fn app_with_document()
-> Result<(tempfile::TempDir, camino::Utf8PathBuf), Box<dyn std::error::Error>> {
    let (guard, app) = empty_directory()?;

    fs::create_dir(app.join("a"))?;
    fs::write(app.join("seampact.config.yaml"), CONFIG)?;
    fs::write(app.join("a/api.yaml"), API)?;

    Ok((guard, app))
}

fn files_in(directory: &Utf8Path) -> Result<Vec<(String, Vec<u8>)>, std::io::Error> {
    let mut files = Vec::new();

    for entry in fs::read_dir(directory)? {
        let entry = entry?;

        files.push((
            entry.file_name().to_string_lossy().into_owned(),
            fs::read(entry.path())?,
        ));
    }

    files.sort();

    Ok(files)
}

#[test]
fn check_passes_after_generate_and_writes_nothing() -> TestResult {
    let (_guard, app) = app_with_document()?;

    let (generated, _) = run(&app, &["generate"])?;
    let before = files_in(&app.join("docs"))?;
    let (checked, io) = run(&app, &["check"])?;

    assert_eq!(generated, EXIT_SUCCESS);
    assert_eq!(checked, EXIT_SUCCESS);
    assert_eq!(
        io.stdout,
        "check: the generated files and documents match the committed ones.\n"
    );
    assert_eq!(files_in(&app.join("docs"))?, before);

    Ok(())
}

#[test]
fn an_edited_document_is_refused_by_check_and_by_generate_until_force() -> TestResult {
    let (_guard, app) = app_with_document()?;

    run(&app, &["generate"])?;
    fs::write(app.join(DOCUMENT), "openapi: 3.1.0\n")?;

    let (checked, check_io) = run(&app, &["check"])?;
    let (refused, generate_io) = run(&app, &["generate"])?;
    let (forced, _) = run(&app, &["generate", "--force"])?;
    let (rechecked, _) = run(&app, &["check"])?;

    assert_eq!(checked, EXIT_REFUSED);
    assert!(
        check_io.stderr.contains("tasks.yaml"),
        "{}",
        check_io.stderr
    );
    assert_eq!(refused, EXIT_REFUSED);
    assert!(
        generate_io.stderr.contains("--force"),
        "{}",
        generate_io.stderr
    );
    assert_eq!(forced, EXIT_SUCCESS);
    assert_eq!(rechecked, EXIT_SUCCESS);

    Ok(())
}
