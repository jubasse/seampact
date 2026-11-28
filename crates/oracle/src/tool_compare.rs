//! The comparisons of tool outputs: OpenAPI YAML parsed, texts line by line, the bundle manifest
//! normalised, written files by hash and text.

use std::fmt::Write as _;
use std::path::Path;

use indexmap::IndexMap;
use seampact_json::{JsonValue, canonical_document, escape_pointer};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::ustar_listing::gunzipped_ustar_entries;
use crate::{ExpectedWrittenFile, Mismatch, MismatchKind, value_mismatches, yaml_to_json};

/// The file name of a bundle manifest, compared once normalised wherever it is written.
pub const BUNDLE_MANIFEST_FILE: &str = "seampact-bundle.json";

/// Every difference between two OpenAPI YAML texts, both parsed: values and member order count,
/// quoting and wrapping do not.
///
/// # Errors
///
/// When the expected text is no YAML the reader takes.
pub fn yaml_mismatches(expected_text: &str, actual_text: &str) -> Result<Vec<Mismatch>, String> {
    let expected = yaml_to_json(expected_text)?;

    let Ok(actual) = yaml_to_json(actual_text) else {
        return Ok(vec![unparsable()]);
    };

    Ok(value_mismatches(&expected, &actual))
}

/// Every line that differs between two texts, each at the pointer `/<line index>`; a line only
/// in one text is `Added` or `Removed`.
#[must_use]
pub fn line_mismatches(expected_text: &str, actual_text: &str) -> Vec<Mismatch> {
    line_mismatches_below("", expected_text, actual_text)
}

fn line_mismatches_below(base: &str, expected_text: &str, actual_text: &str) -> Vec<Mismatch> {
    let expected_lines: Vec<&str> = expected_text.split('\n').collect();
    let actual_lines: Vec<&str> = actual_text.split('\n').collect();
    let longest = expected_lines.len().max(actual_lines.len());

    (0..longest)
        .filter_map(|index| {
            let expected = expected_lines.get(index).copied();
            let actual = actual_lines.get(index).copied();
            let kind = match (expected, actual) {
                (Some(expected), Some(actual)) if expected == actual => return None,
                (Some(_), Some(_)) => MismatchKind::Value,
                (Some(_), None) => MismatchKind::Removed,
                (None, _) => MismatchKind::Added,
            };

            Some(Mismatch {
                pointer: Some(format!("{base}/{index}")),
                kind,
                expected: expected.map(|line| Value::String(line.to_owned())),
                actual: actual.map(|line| Value::String(line.to_owned())),
            })
        })
        .collect()
}

/// The manifest text with `/compiler` set to `null`, rewritten by the canonical writer: the
/// TypeScript and the Rust builds name different compilers, and nothing else may differ.
///
/// # Errors
///
/// When the text is no JSON object.
pub fn normalized_manifest(text: &str) -> Result<String, String> {
    let mut manifest: JsonValue = serde_json::from_str(text)
        .map_err(|error| format!("the bundle manifest is no JSON: {error}"))?;

    let JsonValue::Object(members) = &mut manifest else {
        return Err("the bundle manifest is no JSON object".to_owned());
    };

    members.insert("compiler".to_owned(), JsonValue::Null);

    Ok(canonical_document(&manifest))
}

/// Every difference between two manifests once normalised, as a byte comparison of the texts.
///
/// # Errors
///
/// When the expected text is no JSON object.
pub fn manifest_mismatches(
    expected_text: &str,
    actual_text: &str,
) -> Result<Vec<Mismatch>, String> {
    let expected = normalized_manifest(expected_text)?;

    let Ok(actual) = normalized_manifest(actual_text) else {
        return Ok(vec![unparsable()]);
    };

    Ok(line_mismatches(&expected, &actual))
}

/// The lowercase hexadecimal SHA-256 of `bytes`, as the expected files write it.
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .fold(String::new(), |mut text, byte| {
            let _ = write!(text, "{byte:02x}");
            text
        })
}

/// Every difference between the files expected written and those written, each at the pointer
/// `/<path>`: a path in one side only, then per path the text line by line when the expected file
/// has text, else the hash; a bundle manifest is compared normalised, an archive by its listing.
#[must_use]
pub fn written_mismatches(
    expected: &IndexMap<String, ExpectedWrittenFile>,
    actual: &IndexMap<String, Vec<u8>>,
) -> Vec<Mismatch> {
    let mut mismatches = Vec::new();

    for (path, expected_file) in expected {
        let pointer = format!("/{}", escape_pointer(path));

        let Some(actual_bytes) = actual.get(path) else {
            mismatches.push(only_in_one(pointer, MismatchKind::Removed));

            continue;
        };

        mismatches.extend(file_mismatches(&pointer, path, expected_file, actual_bytes));
    }

    for path in actual.keys().filter(|path| !expected.contains_key(*path)) {
        mismatches.push(only_in_one(
            format!("/{}", escape_pointer(path)),
            MismatchKind::Added,
        ));
    }

    mismatches
}

fn file_mismatches(
    pointer: &str,
    path: &str,
    expected: &ExpectedWrittenFile,
    actual_bytes: &[u8],
) -> Vec<Mismatch> {
    if let Some(expected_entries) = &expected.ustar {
        return listing_mismatches(pointer, expected_entries, actual_bytes);
    }

    let actual_text = std::str::from_utf8(actual_bytes).ok();

    if let (Some(expected_text), Some(actual_text)) = (expected.text.as_deref(), actual_text) {
        let is_manifest = path.rsplit('/').next() == Some(BUNDLE_MANIFEST_FILE);

        if is_manifest
            && let (Ok(expected_manifest), Ok(actual_manifest)) = (
                normalized_manifest(expected_text),
                normalized_manifest(actual_text),
            )
        {
            return line_mismatches_below(pointer, &expected_manifest, &actual_manifest);
        }

        if is_openapi_document(path, expected_text) {
            return yaml_document_mismatches(pointer, expected_text, actual_text);
        }

        return line_mismatches_below(pointer, expected_text, actual_text);
    }

    let actual_sha256 = sha256_hex(actual_bytes);

    if actual_sha256 == expected.sha256 {
        return Vec::new();
    }

    vec![Mismatch {
        pointer: Some(format!("{pointer}/sha256")),
        kind: MismatchKind::Value,
        expected: Some(Value::String(expected.sha256.clone())),
        actual: Some(Value::String(actual_sha256)),
    }]
}

/// The first line of an OpenAPI document the emitters write.
const OPENAPI_DOCUMENT_START: &str = "openapi: ";

/// Whether the written file is an OpenAPI YAML document, which compares parsed.
fn is_openapi_document(path: &str, text: &str) -> bool {
    Path::new(path)
        .extension()
        .is_some_and(|extension| extension == "yaml")
        && text.starts_with(OPENAPI_DOCUMENT_START)
}

/// The mismatches of two OpenAPI documents, parsed, each below `pointer`.
fn yaml_document_mismatches(
    pointer: &str,
    expected_text: &str,
    actual_text: &str,
) -> Vec<Mismatch> {
    match yaml_mismatches(expected_text, actual_text) {
        Ok(mismatches) => mismatches
            .into_iter()
            .map(|mismatch| Mismatch {
                pointer: mismatch.pointer.map(|inner| format!("{pointer}{inner}")),
                ..mismatch
            })
            .collect(),
        Err(_) => line_mismatches_below(pointer, expected_text, actual_text),
    }
}

/// The archive's listing against the expected one, each mismatch below `<pointer>/ustar`.
fn listing_mismatches(
    pointer: &str,
    expected_entries: &Value,
    actual_bytes: &[u8],
) -> Vec<Mismatch> {
    let Ok(actual_entries) = gunzipped_ustar_entries(actual_bytes) else {
        return vec![Mismatch {
            pointer: Some(pointer.to_owned()),
            ..unparsable()
        }];
    };

    value_mismatches(expected_entries, &actual_entries)
        .into_iter()
        .map(|mismatch| Mismatch {
            pointer: Some(format!(
                "{pointer}/ustar{}",
                mismatch.pointer.unwrap_or_default()
            )),
            ..mismatch
        })
        .collect()
}

fn only_in_one(pointer: String, kind: MismatchKind) -> Mismatch {
    Mismatch {
        pointer: Some(pointer),
        kind,
        expected: None,
        actual: None,
    }
}

pub(crate) fn unparsable() -> Mismatch {
    Mismatch {
        pointer: None,
        kind: MismatchKind::Unparsable,
        expected: None,
        actual: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yaml_compares_values_and_order_never_quoting() {
        assert_eq!(
            yaml_mismatches(
                "a: 'x'
b: 1
",
                "a: x
b: 1
"
            )
            .unwrap(),
            []
        );

        let reordered = yaml_mismatches("a: 1\nb: 2\n", "b: 2\na: 1\n").unwrap();

        assert!(
            reordered
                .iter()
                .any(|mismatch| mismatch.kind == MismatchKind::MemberOrder),
            "{reordered:?}"
        );
    }

    #[test]
    fn lines_are_addressed_by_their_index() {
        let mismatches = line_mismatches("a\nb\n", "a\nc\nd\n");

        let pointers: Vec<(Option<&str>, MismatchKind)> = mismatches
            .iter()
            .map(|mismatch| (mismatch.pointer.as_deref(), mismatch.kind))
            .collect();

        assert_eq!(
            pointers,
            [
                (Some("/1"), MismatchKind::Value),
                (Some("/2"), MismatchKind::Value),
                (Some("/3"), MismatchKind::Added),
            ]
        );
    }

    #[test]
    fn manifests_that_differ_only_by_compiler_match() {
        let typescript =
            r#"{"name":"a","compiler":{"name":"@seampact/compiler","version":"1.9.0"},"files":[]}"#;
        let rust = r#"{"name":"a","compiler":{"name":"seampact","version":"2.0.0"},"files":[]}"#;

        assert_eq!(manifest_mismatches(typescript, rust).unwrap(), []);
        assert_ne!(
            manifest_mismatches(typescript, r#"{"name":"b","files":[]}"#).unwrap(),
            []
        );
    }

    #[test]
    fn an_openapi_document_written_with_another_layout_matches_by_value() {
        let expected_text = "openapi: 3.1.0\npaths:\n  /a/{id}: {}\n";
        let actual_text = "openapi: 3.1.0\npaths:\n  \"/a/{id}\": {}\n\n";
        let written = |text: &str| {
            let expected: IndexMap<String, ExpectedWrittenFile> = [(
                "docs/a.yaml".to_owned(),
                ExpectedWrittenFile {
                    sha256: sha256_hex(text.as_bytes()),
                    text: Some(text.to_owned()),
                    ustar: None,
                },
            )]
            .into_iter()
            .collect();
            let actual: IndexMap<String, Vec<u8>> =
                [("docs/a.yaml".to_owned(), actual_text.as_bytes().to_vec())]
                    .into_iter()
                    .collect();

            written_mismatches(&expected, &actual)
        };

        assert_eq!(written(expected_text), []);
        assert_ne!(written("openapi: 3.0.0\npaths: {}\n"), []);
    }

    #[test]
    fn written_files_compare_by_text_then_by_hash() {
        let expected: IndexMap<String, ExpectedWrittenFile> = [
            (
                "a.txt".to_owned(),
                ExpectedWrittenFile {
                    sha256: sha256_hex(b"x\n"),
                    text: Some("x\n".to_owned()),
                    ustar: None,
                },
            ),
            (
                "b.bin".to_owned(),
                ExpectedWrittenFile {
                    sha256: sha256_hex(&[0, 255]),
                    text: None,
                    ustar: None,
                },
            ),
            (
                "gone".to_owned(),
                ExpectedWrittenFile {
                    sha256: sha256_hex(b""),
                    text: Some(String::new()),
                    ustar: None,
                },
            ),
        ]
        .into_iter()
        .collect();
        let actual: IndexMap<String, Vec<u8>> = [
            ("a.txt".to_owned(), b"x\n".to_vec()),
            ("b.bin".to_owned(), vec![0, 254]),
            ("new".to_owned(), Vec::new()),
        ]
        .into_iter()
        .collect();

        assert_eq!(
            written_mismatches(&expected, &actual)
                .iter()
                .map(|mismatch| mismatch.pointer.clone().unwrap_or_default())
                .collect::<Vec<_>>(),
            ["/b.bin/sha256", "/gone", "/new"]
        );
    }
}
