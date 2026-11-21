//! The files of one tool case on both sides, and their mismatches in the format each file has.

use camino::Utf8Path;
use indexmap::IndexMap;
use seampact_json::{JsonValue, indented_json};
use serde_json::Value;

use crate::compare::{Mismatch, MismatchKind, only_in_one, text_mismatches};
use crate::tool_compare::{line_mismatches, manifest_mismatches, unparsable, yaml_mismatches};
use crate::yaml_value::yaml_to_json;
use crate::{OracleError, OutputFile, OutputKind};

/// How a tool output file is compared.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OutputFormat {
    /// JSON values, member order included.
    Json,
    /// OpenAPI YAML, parsed.
    Yaml,
    /// Text, line by line.
    Lines,
    /// A bundle manifest, `/compiler` set to `null`, then line by line.
    Manifest,
}

/// One tool output file: its name under the case's expected directory and its text.
#[derive(Debug, Clone)]
pub(crate) struct NamedOutput {
    pub(crate) name: String,
    pub(crate) file: OutputFile,
    pub(crate) format: OutputFormat,
    pub(crate) text: String,
}

/// One compared file and its mismatches, with both texts for the failure's context.
#[derive(Debug, Clone)]
pub(crate) struct ComparedOutput {
    pub(crate) name: String,
    pub(crate) file: OutputFile,
    pub(crate) mismatches: Vec<Mismatch>,
    pub(crate) expected_text: Option<String>,
    pub(crate) actual_text: Option<String>,
}

/// What one tool case gave.
#[derive(Debug, Clone)]
pub(crate) enum CaseOutcome {
    NotPorted,
    InternalError(String),
    Compared(Vec<ComparedOutput>),
}

/// The [`OutputFile`] of an output with no api.
pub(crate) const fn output_file(output: OutputKind) -> OutputFile {
    OutputFile {
        output,
        api: None,
        half: None,
    }
}

/// The [`OutputFile`] of an output of `api`.
pub(crate) fn api_output_file(output: OutputKind, api: &str) -> OutputFile {
    OutputFile {
        output,
        api: Some(api.to_owned()),
        half: None,
    }
}

/// The file `name` below `case_directory`, when it exists.
///
/// # Errors
///
/// When the file exists and cannot be read.
pub(crate) fn expected_output(
    case_directory: &Utf8Path,
    name: &str,
    file: OutputFile,
    format: OutputFormat,
) -> Result<Option<NamedOutput>, OracleError> {
    let path = case_directory.join(name);

    if !path.is_file() {
        return Ok(None);
    }

    let text = std::fs::read_to_string(&path).map_err(|source| OracleError::Read {
        path: path.clone(),
        source,
    })?;

    Ok(Some(NamedOutput {
        name: name.to_owned(),
        file,
        format,
        text,
    }))
}

/// A JSON output the subject gave, written as the oracle writes JSON files.
pub(crate) fn json_output(name: String, file: OutputFile, value: &JsonValue) -> NamedOutput {
    NamedOutput {
        name,
        file,
        format: OutputFormat::Json,
        text: indented_json(value),
    }
}

/// Every file of both sides compared by name: a file on one side only is a mismatch at the root.
///
/// # Errors
///
/// When an expected file is not in its format: the path names it.
pub(crate) fn compare_outputs(
    case_directory: &Utf8Path,
    expected: Vec<NamedOutput>,
    actual: Vec<NamedOutput>,
) -> Result<Vec<ComparedOutput>, OracleError> {
    let mut actual_by_name: IndexMap<String, NamedOutput> = actual
        .into_iter()
        .map(|output| (output.name.clone(), output))
        .collect();
    let mut compared = Vec::new();

    for expected_output in expected {
        let invalid = |problem: String| OracleError::Shape {
            path: case_directory.join(&expected_output.name),
            problem,
        };

        let actual_output = actual_by_name.shift_remove(&expected_output.name);
        let mismatches = if let Some(actual_output) = &actual_output {
            file_mismatches(
                expected_output.format,
                &expected_output.text,
                &actual_output.text,
            )
            .map_err(invalid)?
        } else {
            let whole =
                whole_value(expected_output.format, &expected_output.text).map_err(invalid)?;

            vec![only_in_one(String::new(), MismatchKind::Removed, &whole)]
        };

        compared.push(ComparedOutput {
            name: expected_output.name,
            file: expected_output.file,
            mismatches,
            expected_text: Some(expected_output.text),
            actual_text: actual_output.map(|output| output.text),
        });
    }

    for (name, actual_output) in actual_by_name {
        let mismatch = match whole_value(actual_output.format, &actual_output.text) {
            Ok(whole) => only_in_one(String::new(), MismatchKind::Added, &whole),
            Err(_) => unparsable(),
        };

        compared.push(ComparedOutput {
            name,
            file: actual_output.file,
            mismatches: vec![mismatch],
            expected_text: None,
            actual_text: Some(actual_output.text),
        });
    }

    Ok(compared)
}

/// The mismatches below `prefix`: each pointer is prefixed, a text-only mismatch kept as it is.
pub(crate) fn below(prefix: &str, mismatches: Vec<Mismatch>) -> Vec<Mismatch> {
    mismatches
        .into_iter()
        .map(|mismatch| Mismatch {
            pointer: mismatch.pointer.map(|pointer| format!("{prefix}{pointer}")),
            ..mismatch
        })
        .collect()
}

fn file_mismatches(
    format: OutputFormat,
    expected_text: &str,
    actual_text: &str,
) -> Result<Vec<Mismatch>, String> {
    match format {
        OutputFormat::Json => {
            text_mismatches(expected_text, actual_text).map_err(|error| error.to_string())
        }
        OutputFormat::Yaml => yaml_mismatches(expected_text, actual_text),
        OutputFormat::Lines => Ok(line_mismatches(expected_text, actual_text)),
        OutputFormat::Manifest => manifest_mismatches(expected_text, actual_text),
    }
}

fn whole_value(format: OutputFormat, text: &str) -> Result<Value, String> {
    match format {
        OutputFormat::Json => serde_json::from_str(text).map_err(|error| error.to_string()),
        OutputFormat::Yaml => yaml_to_json(text),
        OutputFormat::Lines | OutputFormat::Manifest => Ok(Value::String(text.to_owned())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    type MismatchAt<'output> = (Option<&'output str>, MismatchKind);

    fn lines(name: &str, text: &str) -> NamedOutput {
        NamedOutput {
            name: name.to_owned(),
            file: output_file(OutputKind::DiffReport),
            format: OutputFormat::Lines,
            text: text.to_owned(),
        }
    }

    #[test]
    fn a_file_on_one_side_only_is_one_mismatch_at_the_root() {
        let compared = compare_outputs(
            Utf8Path::new("case"),
            vec![
                lines("kept.txt", "a\nb\n"),
                lines("expected-only.txt", "x\n"),
            ],
            vec![lines("kept.txt", "a\nc\n"), lines("actual-only.txt", "y\n")],
        )
        .unwrap();

        let summary: Vec<(&str, Vec<MismatchAt<'_>>)> = compared
            .iter()
            .map(|output| {
                let mismatches = output
                    .mismatches
                    .iter()
                    .map(|mismatch| (mismatch.pointer.as_deref(), mismatch.kind))
                    .collect();

                (output.name.as_str(), mismatches)
            })
            .collect();

        assert_eq!(
            summary,
            vec![
                ("kept.txt", vec![(Some("/1"), MismatchKind::Value)]),
                ("expected-only.txt", vec![(Some(""), MismatchKind::Removed)]),
                ("actual-only.txt", vec![(Some(""), MismatchKind::Added)]),
            ]
        );
    }

    #[test]
    fn mismatches_below_a_field_keep_their_kind_under_the_prefix() {
        let moved = below("/stdout", line_mismatches("a\n", "b\n"));

        assert_eq!(moved.len(), 1);
        assert_eq!(moved[0].pointer.as_deref(), Some("/stdout/0"));
        assert_eq!(moved[0].kind, MismatchKind::Value);
    }
}
