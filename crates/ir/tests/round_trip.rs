//! Every committed IR and source map decodes into the typed roots and is written back
//! byte-identical; every IR example keeps its value, bar the unknown members readers drop.

#[path = "../../json/tests/support/mod.rs"]
mod support;

use std::fs;
use std::path::{Path, PathBuf};

use seampact_ir::{ContractIr, IrError, SourceMap};
use seampact_json::{JsonValue, escape_pointer};
use support::{files_under, repository_root};

/// The expected outputs of every fixture, written by the TypeScript canonical writer.
const EXPECTED_OUTPUTS_DIRECTORY: &str = "fixtures/expected";

/// The IR examples of the IR schema: hand-written, so compared by value.
const IR_EXAMPLES_DIRECTORY: &str = "packages/core/spec/schemas/ir/examples";

/// The example whose unknown members readers drop.
const UNKNOWN_MEMBER_EXAMPLE: &str = "unknown-member.ir.json";

/// The file name ending of a source-map example.
const SOURCE_MAP_EXAMPLE_ENDING: &str = ".source-map.json";

/// Which typed root a file decodes into.
#[derive(Debug, Clone, Copy)]
enum Root {
    Ir,
    SourceMap,
}

/// The value written back by the typed root, and its canonical text.
struct Rewritten {
    value: JsonValue,
    text: String,
}

fn rewrite(root: Root, text: &str) -> Result<Rewritten, IrError> {
    let (value, text) = match root {
        Root::Ir => {
            let document = ContractIr::from_json_text(text)?;

            (document.to_json_value()?, document.canonical_text()?)
        }
        Root::SourceMap => {
            let document = SourceMap::from_json_text(text)?;

            (document.to_json_value()?, document.canonical_text()?)
        }
    };

    Ok(Rewritten { value, text })
}

/// One place where two values differ.
#[derive(Debug, PartialEq)]
enum Difference {
    /// A member the first value has and the second lacks.
    Dropped(String),
    /// Any other difference.
    Changed(String),
}

/// Every difference between `original` and `rewritten`, in document order of `original`; an
/// object member is compared by name, whatever the order.
fn differences(
    original: &JsonValue,
    rewritten: &JsonValue,
    pointer: &str,
    found: &mut Vec<Difference>,
) {
    match (original, rewritten) {
        (JsonValue::Object(original_members), JsonValue::Object(rewritten_members)) => {
            for (key, original_member) in original_members {
                let member_pointer = format!("{pointer}/{}", escape_pointer(key));

                match rewritten_members.get(key) {
                    Some(rewritten_member) => {
                        differences(original_member, rewritten_member, &member_pointer, found);
                    }
                    None => found.push(Difference::Dropped(member_pointer)),
                }
            }

            for key in rewritten_members.keys() {
                if !original_members.contains_key(key) {
                    found.push(Difference::Changed(format!(
                        "{pointer}/{}",
                        escape_pointer(key)
                    )));
                }
            }
        }
        (JsonValue::Array(original_items), JsonValue::Array(rewritten_items))
            if original_items.len() == rewritten_items.len() =>
        {
            for (index, (original_item, rewritten_item)) in
                original_items.iter().zip(rewritten_items).enumerate()
            {
                differences(
                    original_item,
                    rewritten_item,
                    &format!("{pointer}/{index}"),
                    found,
                );
            }
        }
        _ if original == rewritten => {}
        _ => found.push(Difference::Changed(pointer.to_owned())),
    }
}

fn differences_between(original: &JsonValue, rewritten: &JsonValue) -> Vec<Difference> {
    let mut found = Vec::new();

    differences(original, rewritten, "", &mut found);

    found
}

/// Whether `path` is a `.json` file directly inside a directory named `parent_name`.
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

fn read_text(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))
}

fn parse_value(path: &Path, text: &str) -> Result<JsonValue, String> {
    serde_json::from_str(text).map_err(|error| format!("{}: {error}", path.display()))
}

/// The first difference of an expected file with its typed rewrite, or `None` when the bytes
/// are identical.
fn expected_file_mismatch(path: &Path, root: Root) -> Result<Option<String>, String> {
    let text = read_text(path)?;
    let rewritten = rewrite(root, &text).map_err(|error| format!("{}: {error}", path.display()))?;

    if rewritten.text == text {
        return Ok(None);
    }

    let original = parse_value(path, &text)?;
    let first_difference = differences_between(&original, &rewritten.value)
        .into_iter()
        .next()
        .map_or_else(
            || "the same value, other bytes".to_owned(),
            |difference| format!("{difference:?}"),
        );

    Ok(Some(format!("{}: {first_difference}", path.display())))
}

#[test]
fn every_expected_ir_and_source_map_is_rewritten_byte_identical() {
    let files = files_under(
        &repository_root().join(EXPECTED_OUTPUTS_DIRECTORY),
        &|path| is_json_in(path, "ir") || is_json_in(path, "source-map"),
    )
    .unwrap();
    let mismatches: Vec<String> = files
        .iter()
        .filter_map(|path| {
            let root = if is_json_in(path, "ir") {
                Root::Ir
            } else {
                Root::SourceMap
            };

            expected_file_mismatch(path, root).unwrap_or_else(Some)
        })
        .collect();

    assert!(
        !files.is_empty(),
        "no IR or source map under {EXPECTED_OUTPUTS_DIRECTORY}"
    );
    assert_eq!(mismatches, Vec::<String>::new(), "of {} files", files.len());
}

fn example_files() -> Vec<PathBuf> {
    files_under(&repository_root().join(IR_EXAMPLES_DIRECTORY), &|path| {
        is_json_in(path, "examples")
    })
    .unwrap()
}

fn example_root(path: &Path) -> Root {
    let is_source_map = path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(SOURCE_MAP_EXAMPLE_ENDING));

    if is_source_map {
        Root::SourceMap
    } else {
        Root::Ir
    }
}

fn is_unknown_member_example(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|name| name == UNKNOWN_MEMBER_EXAMPLE)
}

/// The differences of an example with its typed rewrite, and whether the rewrite's canonical
/// text reads back to the same text.
fn example_rewrite(path: &Path) -> Result<(Vec<Difference>, bool), String> {
    let root = example_root(path);
    let text = read_text(path)?;
    let original = parse_value(path, &text)?;
    let rewritten = rewrite(root, &text).map_err(|error| format!("{}: {error}", path.display()))?;
    let reread =
        rewrite(root, &rewritten.text).map_err(|error| format!("{}: {error}", path.display()))?;

    Ok((
        differences_between(&original, &rewritten.value),
        reread.text == rewritten.text,
    ))
}

#[test]
fn every_ir_example_keeps_its_value_and_its_canonical_text_is_stable() {
    let files = example_files();
    let changed_examples: Vec<String> = files
        .iter()
        .filter(|path| !is_unknown_member_example(path))
        .filter_map(|path| {
            let (found_differences, is_stable) = example_rewrite(path).unwrap();

            (!found_differences.is_empty() || !is_stable).then(|| {
                format!(
                    "{}: {found_differences:?}, stable: {is_stable}",
                    path.display()
                )
            })
        })
        .collect();

    assert!(
        files.len() > 1,
        "no IR example under {IR_EXAMPLES_DIRECTORY}"
    );
    assert_eq!(
        changed_examples,
        Vec::<String>::new(),
        "of {} files",
        files.len()
    );
}

#[test]
fn the_unknown_member_example_differs_by_its_dropped_unknown_members_only() {
    let path = repository_root()
        .join(IR_EXAMPLES_DIRECTORY)
        .join(UNKNOWN_MEMBER_EXAMPLE);
    let (found_differences, is_stable) = example_rewrite(&path).unwrap();
    let other_differences: Vec<&Difference> = found_differences
        .iter()
        .filter(|difference| !matches!(difference, Difference::Dropped(_)))
        .collect();

    assert!(is_stable);
    assert!(
        !found_differences.is_empty(),
        "no unknown member was dropped"
    );
    assert_eq!(other_differences, Vec::<&Difference>::new());
}
