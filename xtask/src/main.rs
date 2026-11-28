//! Workspace tasks of the Rust port, run as `cargo xtask <task>` from anywhere in the workspace.

#![expect(
    clippy::print_stdout,
    clippy::print_stderr,
    reason = "xtask reports gate steps on the terminal"
)]

mod deps;
mod gate;
mod gate_stamp;
mod oracle;
mod outcome;
mod prerequisite;
mod release_gate;

use std::path::Path;
use std::process::ExitCode;
use std::time::Duration;

use anyhow::Context;
use camino::Utf8PathBuf;
use seampact_oracle::{FixtureGlob, Tool};

use crate::gate::GateMode;
use crate::outcome::StepOutcome;

const USAGE: &str = "usage: cargo xtask (gate [--fail-fast] | oracle [<glob>] [--half <name> | --tool <name>] [--time-limit <seconds>])";

/// The exit code of a command line that names no known task or selects nothing.
const EXIT_USAGE: u8 = 2;

/// The flag that leaves out the build and test steps once a read-only step fails.
const FAIL_FAST_FLAG: &str = "--fail-fast";

/// The flag that compares one pass half alone.
const HALF_FLAG: &str = "--half";

/// The flag that runs one tool alone.
const TOOL_FLAG: &str = "--tool";

/// The flag that sets the seconds one fixture may take.
const TIME_LIMIT_FLAG: &str = "--time-limit";

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
        Some((task, gate_arguments)) if task == "gate" => Ok(match gate_mode(gate_arguments) {
            Some(mode) => gate_task(&workspace_root, mode),
            None => usage_error(None),
        }),
        Some((task, oracle_arguments)) if task == "oracle" => {
            match oracle_request(oracle_arguments) {
                Some(request) => oracle_task(&workspace_root, &request),
                None => Ok(usage_error(None)),
            }
        }
        _ => Ok(usage_error(None)),
    }
}

/// The mode of `gate [--fail-fast]`, or `None` when the arguments are not that.
fn gate_mode(arguments: &[String]) -> Option<GateMode> {
    match arguments {
        [] => Some(GateMode::Full),
        [flag] if flag == FAIL_FAST_FLAG => Some(GateMode::FailFast),
        _ => None,
    }
}

fn gate_task(workspace_root: &camino::Utf8Path, mode: GateMode) -> ExitCode {
    gate_stamp::clear_gate_stamp(workspace_root);

    let reports = gate::run_gate(workspace_root, mode);

    for report in &reports {
        print!("{}", report.stdout);
        eprint!("{}", report.stderr);
    }

    for report in &reports {
        println!("{}", report.outcome);
    }

    // A step left out only follows a failure, but the stamp still needs every step to have passed.
    if reports
        .iter()
        .any(|report| !matches!(report.outcome, StepOutcome::Passed { .. }))
    {
        return ExitCode::FAILURE;
    }

    gate_stamp::write_gate_stamp(workspace_root);

    ExitCode::SUCCESS
}

fn oracle_task(
    workspace_root: &camino::Utf8Path,
    request: &oracle::OracleRequest,
) -> anyhow::Result<ExitCode> {
    match oracle::run_oracle_task(workspace_root, request) {
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

/// The request of `oracle [<glob>] [--half <name> | --tool <name>] [--time-limit <seconds>]`, or
/// `None` when the arguments are not that.
fn oracle_request(arguments: &[String]) -> Option<oracle::OracleRequest> {
    let mut selection = oracle::default_selection();
    let mut tool = None;
    let mut remaining = arguments.iter();

    while let Some(argument) = remaining.next() {
        if argument == TIME_LIMIT_FLAG {
            let seconds: u64 = remaining.next()?.parse().ok()?;

            selection.fixture_time_limit = Some(Duration::from_secs(seconds));

            continue;
        }

        if argument == TOOL_FLAG {
            let named = Tool::from_name(remaining.next()?)?;

            if tool.replace(named).is_some() || selection.half.is_some() {
                return None;
            }

            continue;
        }

        if argument == HALF_FLAG {
            let half = remaining.next()?;

            if selection.half.replace(half.clone()).is_some() || tool.is_some() {
                return None;
            }

            continue;
        }

        if argument.starts_with("--") || selection.fixture_glob.is_some() {
            return None;
        }

        selection.fixture_glob = Some(FixtureGlob::new(argument));
    }

    Some(oracle::OracleRequest { selection, tool })
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
    fn the_gate_takes_only_the_fail_fast_flag() {
        assert_eq!(gate_mode(&[]), Some(GateMode::Full));
        assert_eq!(
            gate_mode(&arguments("--fail-fast")),
            Some(GateMode::FailFast)
        );
        assert_eq!(gate_mode(&arguments("--fast")), None);
        assert_eq!(gate_mode(&arguments("--fail-fast extra")), None);
    }

    #[test]
    fn the_oracle_takes_one_glob_and_one_half_in_any_order() {
        let selection = oracle_request(&arguments("--half tree.nodes golden/*"))
            .unwrap()
            .selection;

        assert_eq!(selection.half.as_deref(), Some("tree.nodes"));
        assert_eq!(selection.fixture_glob, Some(FixtureGlob::new("golden/*")));
        assert!(oracle_request(&[]).is_some());
    }

    #[test]
    fn the_time_limit_defaults_to_two_minutes_and_a_flag_changes_it() {
        let default = oracle_request(&[]).unwrap().selection;
        let changed = oracle_request(&arguments("--time-limit 30"))
            .unwrap()
            .selection;

        assert_eq!(default.fixture_time_limit, Some(Duration::from_secs(120)));
        assert_eq!(changed.fixture_time_limit, Some(Duration::from_secs(30)));
    }

    #[test]
    fn a_time_limit_that_is_not_a_number_of_seconds_is_refused() {
        for refused in ["--time-limit", "--time-limit soon", "--time-limit -1"] {
            assert!(oracle_request(&arguments(refused)).is_none(), "{refused}");
        }
    }

    #[test]
    fn two_globs_a_half_without_a_name_and_an_unknown_flag_are_refused() {
        for refused in ["a b", "--half", "--half a --half b", "--all"] {
            assert!(oracle_request(&arguments(refused)).is_none(), "{refused}");
        }
    }

    #[test]
    fn the_oracle_takes_one_known_tool_never_beside_a_half() {
        let request = oracle_request(&arguments("cli/** --tool cli-config")).unwrap();

        assert_eq!(request.tool, Some(Tool::CliConfig));
        assert_eq!(
            request.selection.fixture_glob,
            Some(FixtureGlob::new("cli/**"))
        );

        for refused in [
            "--tool",
            "--tool compiler",
            "--tool cli --tool lint",
            "--tool cli --half tree.nodes",
            "--half tree.nodes --tool cli",
        ] {
            assert!(oracle_request(&arguments(refused)).is_none(), "{refused}");
        }
    }
}
