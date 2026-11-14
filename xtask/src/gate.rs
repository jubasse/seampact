//! The local gate of the Rust port (PORTING.md section 8), step by step.

use std::process::Command;

use camino::Utf8Path;

use crate::oracle::oracle_gate_step;
use crate::outcome::StepOutcome;
use crate::prerequisite::missing_node_modules_problem;

/// One gate step that runs a command from the workspace root.
struct CommandStep {
    name: &'static str,
    program: &'static str,
    arguments: &'static [&'static str],
    needs_node_modules: bool,
}

/// The commands of PORTING.md section 8, then the trace check, in run order.
const COMMAND_STEPS: &[CommandStep] = &[
    CommandStep {
        name: "fmt",
        program: "cargo",
        arguments: &["fmt", "--all", "--check"],
        needs_node_modules: false,
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
        needs_node_modules: false,
    },
    CommandStep {
        name: "nextest",
        program: "cargo",
        arguments: &["nextest", "run", "--workspace", "--run-ignored", "all"],
        needs_node_modules: false,
    },
    CommandStep {
        name: "deny",
        program: "cargo",
        arguments: &["deny", "check"],
        needs_node_modules: false,
    },
    CommandStep {
        name: "machete",
        // Started as `cargo machete` under `cargo run`, it reads `machete` as a path to scan.
        program: "cargo-machete",
        arguments: &[],
        needs_node_modules: false,
    },
    CommandStep {
        name: "trace",
        program: "node",
        arguments: &["scripts/rust/trace-check.ts"],
        needs_node_modules: true,
    },
];

/// Runs every gate step, the oracle last, and returns their outcomes in run order.
///
/// A failed step does not stop the gate, so one run reports every step.
pub fn run_gate(workspace_root: &Utf8Path) -> Vec<StepOutcome> {
    let mut outcomes: Vec<StepOutcome> = COMMAND_STEPS
        .iter()
        .map(|step| run_command_step(step, workspace_root))
        .collect();

    outcomes.push(oracle_gate_step(workspace_root));

    outcomes
}

fn run_command_step(step: &CommandStep, workspace_root: &Utf8Path) -> StepOutcome {
    if step.needs_node_modules
        && let Some(problem) = missing_node_modules_problem(workspace_root)
    {
        eprintln!("{}: {problem}", step.name);

        return StepOutcome::Failed { step: step.name };
    }

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
