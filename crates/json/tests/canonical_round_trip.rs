//! The canonical writer reproduces every committed IR and source map, and keeps the value of
//! every IR example.

mod support;

use std::fs;
use std::path::{Path, PathBuf};

use seampact_json::{JsonValue, canonical_document};
use support::{files_under, repository_root};

/// The expected outputs of every fixture, written by the TypeScript canonical writer.
const EXPECTED_OUTPUTS_DIRECTORY: &str = "fixtures/expected";

/// The IR examples of the IR schema: hand-written, in the formatter's layout and member order.
const IR_EXAMPLES_DIRECTORY: &str = "packages/core/spec/schemas/ir/examples";

/// Whether `path` is a `.json` file directly inside a directory named `parent_name`.
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "each test crate compiles this module; the schema test does not use it"
    )
)]
fn is_json_in(path: &Path, parent_name: &str) -> bool {
    let has_json_extension = path
        .extension()
        .is_some_and(|extension| extension == "json");
    let parent_matches = path
        .parent()
        .and_then(Path::file_name)
        .is_some_and(|name| name == parent_name);

    has_json_extension && parent_matches
}

fn expected_ir_and_source_map_files() -> Result<Vec<PathBuf>, String> {
    let is_ir_or_source_map =
        |path: &Path| is_json_in(path, "ir") || is_json_in(path, "source-map");

    files_under(
        &repository_root().join(EXPECTED_OUTPUTS_DIRECTORY),
        &is_ir_or_source_map,
    )
    .map_err(|error| error.to_string())
}

fn ir_example_files() -> Result<Vec<PathBuf>, String> {
    files_under(&repository_root().join(IR_EXAMPLES_DIRECTORY), &|path| {
        is_json_in(path, "examples")
    })
    .map_err(|error| error.to_string())
}

fn read_value(path: &Path) -> Result<(String, JsonValue), String> {
    let text = fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let value =
        serde_json::from_str(&text).map_err(|error| format!("{}: {error}", path.display()))?;

    Ok((text, value))
}

fn display_paths(paths: &[&PathBuf]) -> Vec<String> {
    paths
        .iter()
        .map(|path| path.display().to_string())
        .collect()
}

#[test]
fn every_expected_ir_and_source_map_is_rewritten_byte_identical() {
    let files = expected_ir_and_source_map_files().unwrap();
    let mismatched_files: Vec<&PathBuf> = files
        .iter()
        .filter(|path| {
            let (original_text, value) = read_value(path).unwrap();

            canonical_document(&value) != original_text
        })
        .collect();

    assert!(
        !files.is_empty(),
        "no IR or source map under {EXPECTED_OUTPUTS_DIRECTORY}"
    );
    assert_eq!(
        display_paths(&mismatched_files),
        Vec::<String>::new(),
        "of {} files",
        files.len()
    );
}

#[test]
fn every_ir_example_keeps_its_value_and_its_canonical_text_is_stable() {
    let files = ir_example_files().unwrap();
    let changed_files: Vec<&PathBuf> = files
        .iter()
        .filter(|path| {
            let (_, value) = read_value(path).unwrap();
            let canonical_text = canonical_document(&value);
            let reread_value: JsonValue = serde_json::from_str(&canonical_text).unwrap();

            reread_value != value || canonical_document(&reread_value) != canonical_text
        })
        .collect();

    assert!(
        !files.is_empty(),
        "no IR example under {IR_EXAMPLES_DIRECTORY}"
    );
    assert_eq!(
        display_paths(&changed_files),
        Vec::<String>::new(),
        "of {} files",
        files.len()
    );
}
