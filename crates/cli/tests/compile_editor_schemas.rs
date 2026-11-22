//! `seampact compile --editor-schemas` run twice: the schema files keep their bytes.

use std::collections::BTreeMap;
use std::fs;

use camino::Utf8Path;
use seampact_cli::EXIT_SUCCESS;

mod common;

use common::{TestResult, empty_directory, run};

const SCHEMAS_DIRECTORY: &str = "contract/.seampact/schemas";

fn schema_files(directory: &Utf8Path) -> Result<BTreeMap<String, Vec<u8>>, std::io::Error> {
    let mut files = BTreeMap::new();

    for entry in fs::read_dir(directory)? {
        let entry = entry?;

        files.insert(
            entry.file_name().to_string_lossy().into_owned(),
            fs::read(entry.path())?,
        );
    }

    Ok(files)
}

#[test]
fn the_editor_schemas_are_the_same_bytes_on_a_second_run() -> TestResult {
    let (_guard, app) = empty_directory()?;

    run(&app, &["init", "--editor-schemas=none"])?;

    let (first_exit, first_io) = run(&app, &["compile", "--editor-schemas"])?;
    let first = schema_files(&app.join(SCHEMAS_DIRECTORY))?;
    let (second_exit, second_io) = run(&app, &["compile", "--editor-schemas"])?;
    let second = schema_files(&app.join(SCHEMAS_DIRECTORY))?;

    assert_eq!(first_exit, EXIT_SUCCESS, "{}", first_io.stderr);
    assert_eq!(second_exit, EXIT_SUCCESS, "{}", second_io.stderr);
    assert!(!first.is_empty(), "no editor schema was written");
    assert_eq!(first, second);

    Ok(())
}
