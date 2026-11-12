//! The reader and validator of `fixtures/expected/differences.yaml`, the intended differences
//! between the TS oracle and the Rust port (semantics: `scripts/oracle/differences.schema.json`).

use std::collections::HashSet;

use camino::{Utf8Path, Utf8PathBuf};
use serde::{Deserialize, Deserializer};
use serde_json::Value;

use crate::fixtures::read_text;
use crate::yaml_value::yaml_to_json;
use crate::{OracleError, OutputKind};

/// The differences file, relative to the repository root.
pub const DIFFERENCES_FILE: &str = "fixtures/expected/differences.yaml";

/// The schema of the differences file, relative to the repository root.
const SCHEMA_FILE: &str = "scripts/oracle/differences.schema.json";

/// The kind of an intended difference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DifferenceChange {
    /// A scalar differs.
    Value,
    /// A member or item only in the Rust output.
    Added,
    /// A member or item only in the TS output.
    Removed,
    /// A `message` or `fix` text differs.
    Message,
    /// A `rule`, `code` or `id` differs.
    CodeRenamed,
    /// A generated file's layout differs.
    Format,
}

/// Which mismatches an entry matches.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Applies {
    /// Globs over fixture paths relative to `fixtures/`.
    pub fixtures: Vec<String>,
    /// The output the mismatch is in.
    pub output: OutputKind,
    /// The api of the file; any api when absent.
    pub api: Option<String>,
    /// The half of the file; any half when absent.
    pub half: Option<String>,
    /// A JSON Pointer, a segment `*` matching any one segment; every output but generated.
    pub pointer: Option<String>,
    /// A glob over a generated file's path.
    pub path: Option<String>,
}

/// One intended difference.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Difference {
    /// Kebab-case and unique in the file.
    pub id: String,
    /// Why the Rust output differs.
    pub reason: String,
    /// The committed doc and anchor that allow the difference.
    pub decision: String,
    /// Which mismatches the entry matches.
    pub applies: Applies,
    /// The kind of difference.
    pub change: DifferenceChange,
    /// The TS value, when the entry names one (a present `null` included).
    #[serde(default, deserialize_with = "present_value")]
    pub from: Option<Value>,
    /// The Rust value, when the entry names one (a present `null` included).
    #[serde(default, deserialize_with = "present_value")]
    pub to: Option<Value>,
}

/// The differences file.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Differences {
    /// Always 1.
    pub version: u32,
    /// The listed differences.
    pub differences: Vec<Difference>,
}

fn present_value<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(deserializer).map(Some)
}

/// Reads and validates the differences file at `path`.
///
/// # Errors
///
/// When the file cannot be read, or [`differences_problems`] finds a problem in it.
pub fn read_differences(
    repository_root: &Utf8Path,
    path: &Utf8Path,
) -> Result<Differences, OracleError> {
    let invalid = |problems: Vec<String>| OracleError::InvalidDifferences {
        path: path.to_owned(),
        problems,
    };

    let document = yaml_to_json(&read_text(path)?).map_err(|problem| invalid(vec![problem]))?;
    let problems = differences_problems(repository_root, &document)?;

    if !problems.is_empty() {
        return Err(invalid(problems));
    }

    Differences::deserialize(&document).map_err(|error| invalid(vec![error.to_string()]))
}

/// The problems of a parsed differences document: schema, duplicate ids, decision docs; empty
/// when it is valid.
///
/// # Errors
///
/// When the schema cannot be read or compiled.
pub fn differences_problems(
    repository_root: &Utf8Path,
    document: &Value,
) -> Result<Vec<String>, OracleError> {
    let mut problems = schema_problems(repository_root, document)?;

    if !problems.is_empty() {
        return Ok(problems);
    }

    let Some(entries) = document.get("differences").and_then(Value::as_array) else {
        return Ok(problems);
    };

    let mut seen_ids = HashSet::new();

    for entry in entries {
        let id = entry.get("id").and_then(Value::as_str).unwrap_or_default();
        let decision = entry
            .get("decision")
            .and_then(Value::as_str)
            .unwrap_or_default();

        if !seen_ids.insert(id) {
            problems.push(format!("{id}: the id is used twice"));
        }

        if let Some(problem) = anchor_problem(repository_root, id, decision)? {
            problems.push(problem);
        }
    }

    Ok(problems)
}

fn schema_problems(
    repository_root: &Utf8Path,
    document: &Value,
) -> Result<Vec<String>, OracleError> {
    let schema_path = repository_root.join(SCHEMA_FILE);
    let schema: Value =
        serde_json::from_str(&read_text(&schema_path)?).map_err(|source| OracleError::Json {
            path: schema_path.clone(),
            source,
        })?;

    let validator =
        jsonschema::validator_for(&schema).map_err(|error| OracleError::InvalidDifferences {
            path: schema_path.clone(),
            problems: vec![error.to_string()],
        })?;

    Ok(validator
        .iter_errors(document)
        .map(|error| {
            let instance_path = error.instance_path().to_string();
            let location = if instance_path.is_empty() {
                "/".to_owned()
            } else {
                instance_path
            };

            format!("{location} {error}")
        })
        .collect())
}

fn anchor_problem(
    repository_root: &Utf8Path,
    id: &str,
    decision: &str,
) -> Result<Option<String>, OracleError> {
    let (file, anchor) = decision.split_once('#').unwrap_or((decision, ""));

    if file.split('/').any(|segment| segment == "..") {
        return Ok(Some(format!("{id}: decision {file} has a '..' segment")));
    }

    let path: Utf8PathBuf = repository_root.join(file);

    if !path.is_file() {
        return Ok(Some(format!("{id}: decision {file} is no committed doc")));
    }

    if has_anchor(&read_text(&path)?, anchor) {
        return Ok(None);
    }

    Ok(Some(format!(
        "{id}: decision {file} has no anchor {anchor}"
    )))
}

fn has_anchor(text: &str, anchor: &str) -> bool {
    if text.contains(&format!("id=\"{anchor}\"")) {
        return true;
    }

    text.split('\n').any(|line| {
        let level = line
            .chars()
            .take_while(|character| *character == '#')
            .count();
        let is_heading = (1..=6).contains(&level) && line.chars().nth(level) == Some(' ');

        is_heading && heading_anchor(line.trim_start_matches('#')) == anchor
    })
}

/// The anchor a Markdown heading gets: lower case, punctuation dropped, spaces to hyphens.
fn heading_anchor(heading: &str) -> String {
    heading
        .trim()
        .to_lowercase()
        .chars()
        .filter(|character| character.is_alphanumeric() || matches!(character, ' ' | '_' | '-'))
        .map(|character| if character == ' ' { '-' } else { character })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_heading_anchor_drops_punctuation_and_joins_words_with_hyphens() {
        assert_eq!(heading_anchor(" What stays (2.0.0)? "), "what-stays-200");
        assert!(has_anchor("# Title\n\n## What stays\n", "what-stays"));
        assert!(has_anchor("<a id=\"a31\"></a>", "a31"));
        assert!(!has_anchor("#Not a heading\n", "not-a-heading"));
    }
}
