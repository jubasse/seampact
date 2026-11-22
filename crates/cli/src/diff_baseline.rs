//! The IRs `seampact diff --against` compares with: an IR file, or a directory of them.

use std::fs;

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_cli_config::CliProblem;
use seampact_diagnostics::InternalError;
use seampact_ir::ContractIr;
use seampact_ir_check::{IrOpenReport, check_open_ir};
use seampact_js::cmp_utf16;
use seampact_json::{JsonValue, stringify_json};

use crate::CliError;
use crate::cli_problem::unlocated_problem;
use crate::compile_command::IR_FILE_SUFFIX;
use crate::not_ported::not_ported_yet;
use crate::step::Step;

const AGAINST_FIX: &str = "Pass `--against` an IR file, or a directory of `<api>.ir.json` files as `seampact compile --out` writes them.";

/// Reads the IR file `path`, or every `*.ir.json` file of the directory `path`, by api id.
///
/// # Errors
///
/// [`CliError::Io`] when a file cannot be read, [`CliError::Internal`] for a bug.
pub(crate) fn read_baseline(
    path: &Utf8Path,
) -> Result<Step<IndexMap<String, ContractIr>>, CliError> {
    let files = match baseline_files(path)? {
        Step::Refused(problems) => return Ok(Step::Refused(problems)),
        Step::Done(files) => files,
    };
    let mut irs = IndexMap::new();
    let mut problems: Vec<CliProblem> = Vec::new();

    for file in &files {
        match read_ir_file(file)? {
            Step::Refused(refused) => problems.extend(refused),
            Step::Done(ir) => {
                irs.insert(ir.api.id.as_str().to_owned(), ir);
            }
        }
    }

    if problems.is_empty() {
        Ok(Step::Done(irs))
    } else {
        Ok(Step::Refused(problems))
    }
}

fn baseline_files(path: &Utf8Path) -> Result<Step<Vec<Utf8PathBuf>>, CliError> {
    let Some(metadata) = stat_if_present(path)? else {
        return Ok(refused(format!(
            "'{path}' does not exist, and `--against` reads a file or a directory (a bundle or a git ref is not read yet)."
        )));
    };

    if !metadata.is_dir() {
        return Ok(Step::Done(vec![path.to_path_buf()]));
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
        return Ok(refused(format!(
            "The directory '{path}' holds no `*{IR_FILE_SUFFIX}` file."
        )));
    }

    Ok(Step::Done(
        names.iter().map(|name| path.join(name)).collect(),
    ))
}

/// `names` sorted as JavaScript's default sort orders them, by UTF-16 code unit.
fn in_utf16_order(mut names: Vec<String>) -> Vec<String> {
    names.sort_by(|left, right| cmp_utf16(left, right));

    names
}

fn read_ir_file(file: &Utf8Path) -> Result<Step<ContractIr>, CliError> {
    let bytes = fs::read(file).map_err(|error| CliError::io(file, &error))?;
    let text = String::from_utf8_lossy(&bytes);
    let document: JsonValue = match serde_json::from_str(&text) {
        Ok(document) => document,
        Err(error) => return Ok(refused(format!("'{file}' is not JSON ({error})."))),
    };
    let report = check_open_ir(&document).map_err(|error| InternalError::new(error.to_string()))?;

    if !report.valid {
        return Ok(refused(invalid_message(file, &report)?));
    }

    let ir = ContractIr::from_json_text(&stringify_json(&document))
        .map_err(|error| InternalError::new(error.to_string()))?;

    Ok(Step::Done(ir))
}

/// What the open IR schema found wrong in `file`.
fn invalid_message(_file: &Utf8Path, _report: &IrOpenReport) -> Result<String, CliError> {
    Err(not_ported_yet("invalidMessage"))
}

fn refused<Value>(message: String) -> Step<Value> {
    Step::Refused(vec![unlocated_problem(
        "diff.against.invalid",
        message,
        AGAINST_FIX,
    )])
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
