//! Workspace tasks of the Rust port, run as `cargo xtask <task>` from anywhere in the workspace.

#![expect(
    clippy::print_stdout,
    clippy::print_stderr,
    reason = "xtask reports gate steps on the terminal"
)]

mod gate;
mod oracle;
mod outcome;

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use anyhow::Context;

use crate::outcome::StepOutcome;

const USAGE: &str = "usage: cargo xtask (gate | oracle)";

/// The exit code of a command line that names no known task.
const EXIT_USAGE: u8 = 2;

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

    let outcomes = match arguments.as_slice() {
        [name] if name == "gate" => gate::run_gate(&workspace_root),
        [name] if name == "oracle" => vec![oracle::run_oracle(&workspace_root)],
        _ => {
            eprintln!("{USAGE}");

            return Ok(ExitCode::from(EXIT_USAGE));
        }
    };

    for outcome in &outcomes {
        println!("{outcome}");
    }

    let any_step_failed = outcomes.iter().any(StepOutcome::is_failure);

    Ok(if any_step_failed {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    })
}

/// The workspace root: the parent of this crate's directory.
fn workspace_root() -> anyhow::Result<PathBuf> {
    let manifest_directory = Path::new(env!("CARGO_MANIFEST_DIR"));

    manifest_directory
        .parent()
        .map(Path::to_path_buf)
        .with_context(|| format!("{} has no parent directory", manifest_directory.display()))
}
