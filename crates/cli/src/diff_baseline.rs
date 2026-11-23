//! The IRs `seampact diff --against` compares with: an IR file, or a directory of them.

use std::fs;

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_cli_config::{CliProblem, Problems, unlocated_problem};
use seampact_diagnostics::InternalError;
use seampact_ir::ContractIr;
use seampact_ir_check::{IrCheckFailure, IrOpenReport, check_open_ir};
use seampact_js::cmp_utf16;
use seampact_json::{JsonValue, stringify_json};

use crate::CliError;
use crate::compile_command::IR_FILE_SUFFIX;
use crate::stop::Stop;

/// How many schema problems a message lists.
const LISTED_PROBLEM_LIMIT: usize = 5;

const AGAINST_FIX: &str = "Pass `--against` an IR file, or a directory of `<api>.ir.json` files as `seampact compile --out` writes them.";

/// Reads the IR file `path`, or every `*.ir.json` file of the directory `path`, by api id.
///
/// # Errors
///
/// [`CliError::Io`] when a file cannot be read, [`CliError::Internal`] for a bug.
pub(crate) fn read_baseline(path: &Utf8Path) -> Result<IndexMap<String, ContractIr>, Stop> {
    let files = baseline_files(path)?;
    let mut irs = IndexMap::new();
    let mut problems: Vec<CliProblem> = Vec::new();

    for file in &files {
        match read_ir_file(file) {
            Ok(ir) => {
                irs.insert(ir.api.id.as_str().to_owned(), ir);
            }
            Err(Stop::Refused(refused)) => problems.extend(refused),
            Err(failed @ Stop::Failed(_)) => return Err(failed),
        }
    }

    Problems::refuse_any(problems)?;

    Ok(irs)
}

fn baseline_files(path: &Utf8Path) -> Result<Vec<Utf8PathBuf>, Stop> {
    let Some(metadata) = stat_if_present(path)? else {
        return Err(refused(format!(
            "'{path}' does not exist, and `--against` reads a file or a directory (a bundle or a git ref is not read yet)."
        )));
    };

    if !metadata.is_dir() {
        return Ok(vec![path.to_path_buf()]);
    }

    let entries = path
        .read_dir_utf8()
        .map_err(|error| CliError::io(path, &error))?;
    let mut names: Vec<String> = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| CliError::io(path, &error))?;
        let name = entry.file_name();

        if name.ends_with(IR_FILE_SUFFIX) {
            names.push(name.to_owned());
        }
    }

    let names = in_utf16_order(names);

    if names.is_empty() {
        return Err(refused(format!(
            "The directory '{path}' holds no `*{IR_FILE_SUFFIX}` file."
        )));
    }

    Ok(names.iter().map(|name| path.join(name)).collect())
}

/// `names` sorted as JavaScript's default sort orders them, by UTF-16 code unit.
fn in_utf16_order(mut names: Vec<String>) -> Vec<String> {
    names.sort_by(|left, right| cmp_utf16(left, right));

    names
}

fn read_ir_file(file: &Utf8Path) -> Result<ContractIr, Stop> {
    let bytes = fs::read(file).map_err(|error| CliError::io(file, &error))?;
    let text = String::from_utf8_lossy(&bytes);
    let document: JsonValue = match serde_json::from_str(&text) {
        Ok(document) => document,
        Err(error) => return Err(refused(format!("'{file}' is not JSON ({error})."))),
    };
    let report = check_open_ir(&document).map_err(|error| InternalError::new(error.to_string()))?;

    if !report.valid {
        return Err(refused(invalid_message(file, &report)));
    }

    let ir = ContractIr::from_json_text(&stringify_json(&document))
        .map_err(|error| InternalError::new(error.to_string()))?;

    Ok(ir)
}

/// What the open IR schema found wrong in `file`: its schema problems, the first few listed.
fn invalid_message(file: &Utf8Path, report: &IrOpenReport) -> String {
    let problems: Vec<String> = report
        .failures
        .iter()
        .filter_map(|failure| match failure {
            IrCheckFailure::Schema {
                pointer, message, ..
            } => Some(format!("at '{pointer}' {message}")),
            IrCheckFailure::UnknownMember { .. }
            | IrCheckFailure::UnknownKind { .. }
            | IrCheckFailure::UnknownValue { .. } => None,
        })
        .collect();
    let listed: Vec<&String> = problems.iter().take(LISTED_PROBLEM_LIMIT).collect();
    let more = problems.len() - listed.len();
    let detail = if listed.is_empty() {
        "it holds a value the IR does not know".to_owned()
    } else {
        listed
            .iter()
            .map(|problem| problem.as_str())
            .collect::<Vec<_>>()
            .join("; ")
    };
    let rest = if more > 0 {
        format!("; and {more} more")
    } else {
        String::new()
    };

    format!("'{file}' is not valid under the IR JSON Schema: {detail}{rest}.")
}

fn refused(message: String) -> Stop {
    Stop::Refused(unlocated_problem("diff.against.invalid", message, AGAINST_FIX).into())
}

/// The metadata of `path`, `None` when nothing is there.
fn stat_if_present(path: &Utf8Path) -> Result<Option<fs::Metadata>, CliError> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(CliError::io(path, &error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_sort_by_utf16_code_unit_not_by_code_point() {
        let names = vec![
            "\u{FFFD}.ir.json".to_owned(),
            "\u{10000}.ir.json".to_owned(),
            "b.ir.json".to_owned(),
            "B.ir.json".to_owned(),
        ];

        assert_eq!(
            in_utf16_order(names),
            [
                "B.ir.json",
                "b.ir.json",
                "\u{10000}.ir.json",
                "\u{FFFD}.ir.json"
            ]
        );
    }
}
