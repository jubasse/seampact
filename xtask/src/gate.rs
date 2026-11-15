//! The local gate of the Rust port (PORTING.md section 8), step by step.

use std::process::Command;
use std::thread;

use camino::Utf8Path;

use crate::oracle::oracle_gate_step;
use crate::outcome::{StepOutcome, StepReport};
use crate::prerequisite::missing_node_modules_problem;

/// Whether a step only reads the workspace or builds and runs it: fail-fast runs the first kind
/// before starting the second.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StepPhase {
    Checks,
    Tests,
}

/// One gate step that runs a command from the workspace root.
struct CommandStep {
    name: &'static str,
    phase: StepPhase,
    program: &'static str,
    arguments: &'static [&'static str],
    needs_node_modules: bool,
}

/// The commands of PORTING.md section 8, then the trace check, in report order.
const COMMAND_STEPS: &[CommandStep] = &[
    CommandStep {
        name: "fmt",
        phase: StepPhase::Checks,
        program: "cargo",
        arguments: &["fmt", "--all", "--check"],
        needs_node_modules: false,
    },
    CommandStep {
        name: "clippy",
        phase: StepPhase::Checks,
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
        phase: StepPhase::Tests,
        program: "cargo",
        arguments: &["nextest", "run", "--workspace", "--run-ignored", "all"],
        needs_node_modules: false,
    },
    CommandStep {
        name: "deny",
        phase: StepPhase::Checks,
        program: "cargo",
        arguments: &["deny", "check"],
        needs_node_modules: false,
    },
    CommandStep {
        name: "machete",
        phase: StepPhase::Checks,
        // Started as `cargo machete` under `cargo run`, it reads `machete` as a path to scan.
        program: "cargo-machete",
        arguments: &[],
        needs_node_modules: false,
    },
    CommandStep {
        name: "trace",
        phase: StepPhase::Checks,
        program: "node",
        arguments: &["scripts/rust/trace-check.ts"],
        needs_node_modules: true,
    },
];

/// The name of the oracle step, run after the command steps in the report.
const ORACLE_STEP: &str = "oracle";

/// The stack of a step thread: the oracle recurses deeper in a debug build than the default 2 MiB
/// of a spawned thread allows (the main thread has 8 MiB).
const STEP_STACK_BYTES: usize = 64 * 1024 * 1024;

/// How much of the gate a run does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateMode {
    /// Every step runs, whatever fails: the gate before hand-back.
    Full,
    /// The steps that only read run first; the build and test steps are left out when one fails.
    FailFast,
}

/// One step of the gate.
#[derive(Clone, Copy)]
enum Step {
    Command(&'static CommandStep),
    Oracle,
}

impl Step {
    fn name(self) -> &'static str {
        match self {
            Self::Command(step) => step.name,
            Self::Oracle => ORACLE_STEP,
        }
    }

    fn phase(self) -> StepPhase {
        match self {
            Self::Command(step) => step.phase,
            Self::Oracle => StepPhase::Tests,
        }
    }

    fn run(self, workspace_root: &Utf8Path) -> StepReport {
        match self {
            Self::Command(step) => run_command_step(step, workspace_root),
            Self::Oracle => oracle_gate_step(workspace_root),
        }
    }
}

/// Runs the gate steps and returns their reports in step order, the oracle last.
///
/// The steps of one batch run at the same time: the command steps are separate processes and the
/// oracle runs in this one, so a slow build waits on cargo's own lock, not on this code. A failed
/// step does not stop its batch, so one run reports every step it ran.
pub fn run_gate(workspace_root: &Utf8Path, mode: GateMode) -> Vec<StepReport> {
    let steps: Vec<Step> = COMMAND_STEPS
        .iter()
        .map(Step::Command)
        .chain(std::iter::once(Step::Oracle))
        .collect();

    match mode {
        GateMode::Full => run_batch(&steps, workspace_root),
        GateMode::FailFast => run_fail_fast(&steps, workspace_root),
    }
}

fn run_fail_fast(steps: &[Step], workspace_root: &Utf8Path) -> Vec<StepReport> {
    let (checks, tests): (Vec<Step>, Vec<Step>) = steps
        .iter()
        .partition(|step| step.phase() == StepPhase::Checks);

    let mut reports = run_batch(&checks, workspace_root);

    let test_reports = if reports.iter().any(|report| report.outcome.is_failure()) {
        tests
            .iter()
            .map(|step| {
                StepReport::not_run(step.name(), "an earlier step failed under --fail-fast")
            })
            .collect()
    } else {
        run_batch(&tests, workspace_root)
    };

    reports.extend(test_reports);
    reports.sort_by_key(|report| {
        steps
            .iter()
            .position(|step| step.name() == report.outcome.step())
    });

    reports
}

/// Runs `steps` at the same time and gives their reports in the order of `steps`.
fn run_batch(steps: &[Step], workspace_root: &Utf8Path) -> Vec<StepReport> {
    thread::scope(|scope| {
        let workers: Vec<_> = steps
            .iter()
            .map(|step| {
                let worker = thread::Builder::new()
                    .name(format!("gate-{}", step.name()))
                    .stack_size(STEP_STACK_BYTES)
                    .spawn_scoped(scope, || step.run(workspace_root));

                (step.name(), worker)
            })
            .collect();

        workers
            .into_iter()
            .map(|(name, worker)| match worker {
                Ok(worker) => worker
                    .join()
                    .unwrap_or_else(|_| StepReport::failed_with(name, "the step thread panicked")),
                Err(error) => StepReport::failed_with(
                    name,
                    &format!("{name}: cannot start its thread: {error}"),
                ),
            })
            .collect()
    })
}

fn run_command_step(step: &CommandStep, workspace_root: &Utf8Path) -> StepReport {
    if step.needs_node_modules
        && let Some(problem) = missing_node_modules_problem(workspace_root)
    {
        return StepReport::failed_with(step.name, &format!("{}: {problem}", step.name));
    }

    let output = Command::new(step.program)
        .args(step.arguments)
        .current_dir(workspace_root)
        .output();

    match output {
        Ok(output) => StepReport {
            outcome: if output.status.success() {
                StepOutcome::Passed { step: step.name }
            } else {
                StepOutcome::Failed { step: step.name }
            },
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        },
        Err(error) => StepReport::failed_with(
            step.name,
            &format!("{}: cannot start {}: {error}", step.name, step.program),
        ),
    }
}
