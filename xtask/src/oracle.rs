//! The oracle task: the harness of `seampact-oracle` run with the compiler subject.

use camino::Utf8Path;
use seampact_json::JsonValue;
use seampact_oracle::{
    Compilation, Fixture, HalfInput, OracleError, OracleSubject, RuleIdRegistry, Selection,
    SubjectAnswer, Verdict, run_oracle,
};

use crate::outcome::StepOutcome;

const ORACLE_STEP: &str = "oracle";

/// The subject of a workspace with no compiler crate: every answer is not ported.
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

/// The compiler the oracle checks: the one place a compiler crate plugs its subject in.
fn compiler_subject() -> impl OracleSubject {
    NothingPortedSubject
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
    run_oracle(workspace_root, selection, &compiler_subject())
}

/// The oracle step of the gate: every fixture, the verdict printed, then the step's outcome.
pub fn oracle_gate_step(workspace_root: &Utf8Path) -> StepOutcome {
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
