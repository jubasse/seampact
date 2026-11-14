//! The oracle task: the harness of `seampact-oracle` run with the compiler subject.

use camino::Utf8Path;
use seampact_compiler::oracle::CompilerSubject;
use seampact_json::JsonValue;
use seampact_oracle::{
    Compilation, Fixture, HalfInput, OracleError, OracleSubject, RuleIdRegistry, Selection,
    SubjectAnswer, Verdict, run_oracle,
};

use crate::outcome::StepOutcome;
use crate::prerequisite::missing_node_modules_problem;

const ORACLE_STEP: &str = "oracle";

/// The subject while no compiler crate is plugged in: every answer is not ported.
struct NothingPortedSubject;

impl OracleSubject for NothingPortedSubject {
    fn compile(&self, _fixture: &Fixture) -> SubjectAnswer<Compilation> {
        SubjectAnswer::NotPorted
    }

    fn run_half(
        &self,
        _fixture: &Fixture,
        _api: &str,
        _half: &str,
        _input: &HalfInput<'_>,
    ) -> SubjectAnswer<JsonValue> {
        SubjectAnswer::NotPorted
    }

    fn rule_id_registry(&self) -> RuleIdRegistry {
        RuleIdRegistry::empty()
    }
}

/// The manifest whose presence means a compiler crate exists and its subject must be plugged in.
const COMPILER_MANIFEST: &str = "crates/compiler/Cargo.toml";

/// The compiler the oracle checks: the one place a compiler crate plugs its subject in, `None`
/// until it does.
#[expect(
    clippy::unnecessary_wraps,
    reason = "the plug point stays an Option: the gate refuses a compiler crate with no subject"
)]
fn compiler_subject() -> Option<Box<dyn OracleSubject>> {
    Some(Box::new(CompilerSubject))
}

/// Why the oracle cannot vouch for the workspace: a compiler crate exists and no subject is
/// plugged into [`compiler_subject`], so every fixture would pass as not ported.
fn unplugged_compiler_problem(
    workspace_root: &Utf8Path,
    plugged_subject: Option<&dyn OracleSubject>,
) -> Option<&'static str> {
    if plugged_subject.is_none() && workspace_root.join(COMPILER_MANIFEST).exists() {
        return Some(
            "compiler crate present but no subject plugged in: return it from compiler_subject in xtask/src/oracle.rs",
        );
    }

    None
}

/// Runs the oracle on `selection` and gives its verdict.
///
/// # Errors
///
/// A usage error when the selection matches nothing; otherwise when a repository file cannot be
/// read or is invalid.
pub fn run_oracle_task(
    workspace_root: &Utf8Path,
    selection: &Selection,
) -> Result<Verdict, OracleError> {
    match compiler_subject() {
        Some(subject) => run_oracle(workspace_root, selection, &*subject),
        None => run_oracle(workspace_root, selection, &NothingPortedSubject),
    }
}

/// The oracle step of the gate: every fixture, the verdict printed, then the step's outcome.
pub fn oracle_gate_step(workspace_root: &Utf8Path) -> StepOutcome {
    let subject = compiler_subject();

    if let Some(problem) = missing_node_modules_problem(workspace_root) {
        eprintln!("{ORACLE_STEP}: {problem}");

        return StepOutcome::Failed { step: ORACLE_STEP };
    }

    if let Some(problem) = unplugged_compiler_problem(workspace_root, subject.as_deref()) {
        eprintln!("{ORACLE_STEP}: {problem}");

        return StepOutcome::Failed { step: ORACLE_STEP };
    }

    match run_oracle_task(workspace_root, &Selection::default()) {
        Ok(verdict) => {
            println!("{verdict}");

            if verdict.passed() {
                StepOutcome::Passed { step: ORACLE_STEP }
            } else {
                StepOutcome::Failed { step: ORACLE_STEP }
            }
        }
        Err(error) => {
            eprintln!("{ORACLE_STEP}: {error}");

            StepOutcome::Failed { step: ORACLE_STEP }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use camino::Utf8PathBuf;

    use super::*;

    fn scratch_workspace(name: &str, with_compiler_crate: &[&str]) -> Utf8PathBuf {
        let directory = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .unwrap()
            .join(format!("xtask-oracle-{name}-{}", std::process::id()));

        for file in with_compiler_crate {
            let path = directory.join(file);

            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "").unwrap();
        }

        fs::create_dir_all(&directory).unwrap();

        directory
    }

    #[test]
    fn no_subject_is_fine_while_there_is_no_compiler_crate() {
        let workspace = scratch_workspace("absent", &[]);

        assert_eq!(unplugged_compiler_problem(&workspace, None), None);

        fs::remove_dir_all(&workspace).unwrap();
    }

    #[test]
    fn no_subject_fails_once_the_compiler_crate_exists() {
        let workspace = scratch_workspace("present", &[COMPILER_MANIFEST]);

        let problem = unplugged_compiler_problem(&workspace, None);

        fs::remove_dir_all(&workspace).unwrap();

        assert!(
            problem.is_some_and(|problem| problem.contains("no subject plugged in")),
            "{problem:?}"
        );
    }

    #[test]
    fn a_plugged_subject_passes_with_the_compiler_crate() {
        let workspace = scratch_workspace("plugged", &[COMPILER_MANIFEST]);

        let problem = unplugged_compiler_problem(&workspace, Some(&NothingPortedSubject));

        fs::remove_dir_all(&workspace).unwrap();

        assert_eq!(problem, None);
    }
}
