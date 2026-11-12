//! The local gate of the Rust port (PORTING.md section 8), step by step.

use std::path::Path;
use std::process::Command;

use crate::oracle::run_oracle;
use crate::outcome::StepOutcome;

/// One gate step that runs a command from the workspace root.
struct CommandStep {
    name: &'static str,
    program: &'static str,
    arguments: &'static [&'static str],
}

/// The commands of PORTING.md section 8, then the trace check, in run order.
const COMMAND_STEPS: &[CommandStep] = &[
    CommandStep {
        name: "fmt",
        program: "cargo",
        arguments: &["fmt", "--all", "--check"],
    },
    CommandStep {
        name: "clippy",
        program: "cargo",
        arguments: &[
            "clippy",
            "--workspace",
            "--all-targets",
            "--quiet",
            "--",
            "-D",
            "warnings",
        ],
    },
    CommandStep {
        name: "nextest",
        program: "cargo",
        arguments: &["nextest", "run", "--workspace"],
    },
    CommandStep {
        name: "deny",
        program: "cargo",
        arguments: &["deny", "check"],
    },
    CommandStep {
        name: "machete",
        // Started as `cargo machete` under `cargo run`, it reads `machete` as a path to scan.
        program: "cargo-machete",
        arguments: &[],
    },
    CommandStep {
        name: "trace",
        program: "node",
        arguments: &["scripts/rust/trace-check.ts"],
    },
];

/// Runs every gate step, the oracle last, and returns their outcomes in run order.
///
/// A failed step does not stop the gate, so one run reports every step.
pub fn run_gate(workspace_root: &Path) -> Vec<StepOutcome> {
    let mut outcomes: Vec<StepOutcome> = COMMAND_STEPS
        .iter()
        .map(|step| run_command_step(step, workspace_root))
        .collect();

    outcomes.push(run_oracle());

    outcomes
}

fn run_command_step(step: &CommandStep, workspace_root: &Path) -> StepOutcome {
    let status = Command::new(step.program)
        .args(step.arguments)
        .current_dir(workspace_root)
        .status();

    match status {
        Ok(status) if status.success() => StepOutcome::Passed { step: step.name },
        Ok(_) => StepOutcome::Failed { step: step.name },
        Err(error) => {
            eprintln!("{}: cannot start {}: {error}", step.name, step.program);

            StepOutcome::Failed { step: step.name }
        }
    }
}
