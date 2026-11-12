//! The oracle step: compares the Rust compiler's outputs with `fixtures/expected/`.

use crate::outcome::StepOutcome;

const ORACLE_STEP: &str = "oracle";

/// Runs the oracle harness; it has nothing to compare until the compiler crate lands.
pub fn run_oracle() -> StepOutcome {
    StepOutcome::NotRun {
        step: ORACLE_STEP,
        reason: "no Rust compiler crate yet",
    }
}
