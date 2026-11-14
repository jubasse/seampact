//! Workspace tasks of the Rust port, run as `cargo xtask <task>` from anywhere in the workspace.

#![expect(
    clippy::print_stdout,
    clippy::print_stderr,
    reason = "xtask reports gate steps on the terminal"
)]

mod gate;
mod oracle;
mod outcome;
mod prerequisite;

use std::path::Path;
use std::process::ExitCode;

use anyhow::Context;
use camino::Utf8PathBuf;
use seampact_oracle::{FixtureGlob, Selection};

use crate::outcome::StepOutcome;

const USAGE: &str = "usage: cargo xtask (gate | oracle [<glob>] [--half <name>])";

/// The exit code of a command line that names no known task or selects nothing.
const EXIT_USAGE: u8 = 2;

/// The flag that compares one pass half alone.
const HALF_FLAG: &str = "--half";

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(error) => {
            eprintln!("xtask: {error:#}");

            ExitCode::FAILURE
        }
    }
}

fn run() -> anyhow::Result<ExitCode> {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let workspace_root = workspace_root()?;

    match arguments.split_first() {
        Some((task, [])) if task == "gate" => Ok(gate_task(&workspace_root)),
        Some((task, oracle_arguments)) if task == "oracle" => {
            match oracle_selection(oracle_arguments) {
                Some(selection) => oracle_task(&workspace_root, &selection),
                None => Ok(usage_error(None)),
            }
        }
        _ => Ok(usage_error(None)),
    }
}

fn gate_task(workspace_root: &camino::Utf8Path) -> ExitCode {
    let outcomes = gate::run_gate(workspace_root);

    for outcome in &outcomes {
        println!("{outcome}");
    }

    if outcomes.iter().any(StepOutcome::is_failure) {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}

fn oracle_task(
    workspace_root: &camino::Utf8Path,
    selection: &Selection,
) -> anyhow::Result<ExitCode> {
    match oracle::run_oracle_task(workspace_root, selection) {
        Ok(verdict) => {
            println!("{verdict}");

            Ok(if verdict.passed() {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            })
        }
        Err(error) if error.is_usage() => Ok(usage_error(Some(&error.to_string()))),
        Err(error) => Err(error.into()),
    }
}

/// The selection of `oracle [<glob>] [--half <name>]`, or `None` when the arguments are not that.
fn oracle_selection(arguments: &[String]) -> Option<Selection> {
    let mut selection = Selection::default();
    let mut remaining = arguments.iter();

    while let Some(argument) = remaining.next() {
        if argument == HALF_FLAG {
            let half = remaining.next()?;

            if selection.half.replace(half.clone()).is_some() {
                return None;
            }

            continue;
        }

        if argument.starts_with("--") || selection.fixture_glob.is_some() {
            return None;
        }

        selection.fixture_glob = Some(FixtureGlob::new(argument));
    }

    Some(selection)
}

fn usage_error(problem: Option<&str>) -> ExitCode {
    if let Some(problem) = problem {
        eprintln!("xtask: {problem}");
    }

    eprintln!("{USAGE}");

    ExitCode::from(EXIT_USAGE)
}

/// The workspace root: the parent of this crate's directory.
fn workspace_root() -> anyhow::Result<Utf8PathBuf> {
    let manifest_directory = Path::new(env!("CARGO_MANIFEST_DIR"));

    let parent = manifest_directory
        .parent()
        .with_context(|| format!("{} has no parent directory", manifest_directory.display()))?;

    Utf8PathBuf::from_path_buf(parent.to_path_buf())
        .map_err(|path| anyhow::anyhow!("{} is not a UTF-8 path", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arguments(text: &str) -> Vec<String> {
        text.split_whitespace().map(str::to_owned).collect()
    }

    #[test]
    fn the_oracle_takes_one_glob_and_one_half_in_any_order() {
        let selection = oracle_selection(&arguments("--half tree.nodes golden/*")).unwrap();

        assert_eq!(selection.half.as_deref(), Some("tree.nodes"));
        assert_eq!(selection.fixture_glob, Some(FixtureGlob::new("golden/*")));
        assert!(oracle_selection(&[]).is_some());
    }

    #[test]
    fn two_globs_a_half_without_a_name_and_an_unknown_flag_are_refused() {
        for refused in ["a b", "--half", "--half a --half b", "--all"] {
            assert!(oracle_selection(&arguments(refused)).is_none(), "{refused}");
        }
    }
}
