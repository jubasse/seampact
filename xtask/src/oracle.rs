//! The oracle step: compares the Rust compiler's outputs with `fixtures/expected/`.

use std::path::Path;

use crate::outcome::StepOutcome;

const ORACLE_STEP: &str = "oracle";

/// The manifest whose presence means the oracle has something to compare.
const COMPILER_MANIFEST: &str = "crates/compiler/Cargo.toml";

/// Runs the oracle harness.
///
/// There is nothing to compare until the compiler crate lands; once its manifest exists and no
/// harness does, the step fails instead of passing silently.
pub fn run_oracle(workspace_root: &Path) -> StepOutcome {
    if workspace_root.join(COMPILER_MANIFEST).exists() {
        return StepOutcome::FailedWithReason {
            step: ORACLE_STEP,
            reason: "compiler crate present but no oracle harness",
        };
    }

    StepOutcome::NotRun {
        step: ORACLE_STEP,
        reason: "no Rust compiler crate yet",
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn scratch_workspace(name: &str) -> std::path::PathBuf {
        let directory =
            std::env::temp_dir().join(format!("xtask-oracle-{name}-{}", std::process::id()));

        fs::create_dir_all(&directory).unwrap();

        directory
    }

    #[test]
    fn oracle_is_not_run_without_a_compiler_crate() {
        let workspace = scratch_workspace("absent");

        let outcome = run_oracle(&workspace);

        fs::remove_dir_all(&workspace).unwrap();

        assert_eq!(
            outcome.to_string(),
            "oracle: not run: no Rust compiler crate yet"
        );
        assert!(!outcome.is_failure());
    }

    #[test]
    fn oracle_fails_once_the_compiler_crate_exists_without_a_harness() {
        let workspace = scratch_workspace("present");

        fs::create_dir_all(workspace.join("crates/compiler")).unwrap();
        fs::write(workspace.join(COMPILER_MANIFEST), "").unwrap();

        let outcome = run_oracle(&workspace);

        fs::remove_dir_all(&workspace).unwrap();

        assert_eq!(
            outcome.to_string(),
            "oracle: failed: compiler crate present but no oracle harness"
        );
        assert!(outcome.is_failure());
    }
}
