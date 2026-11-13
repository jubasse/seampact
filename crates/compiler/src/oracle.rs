//! The oracle subject: the compiler as `cargo xtask oracle` runs it over a fixture.
//!
//! It runs the stages that are ported and answers [`SubjectAnswer::NotPorted`] as soon as a run
//! reaches one that is not, so the loader is compared on every fixture whose load stops.

use seampact_diagnostics::{ApiDiagnostics, InternalError, Severity, diagnostics_json};
use seampact_json::JsonValue;
use seampact_load::{FsReader, FsReaderError, LoadOptions, LoadRule, load_workspace};
use seampact_oracle::{
    Compilation, Fixture, HalfInput, OracleSubject, RuleIdRegistry, StagePorting, StageRuleIds,
    SubjectAnswer,
};
use thiserror::Error;

/// The stage name of the load rules: the second segment of their ids.
const LOAD_STAGE: &str = "load";

/// Why a fixture could not be compiled at all.
#[derive(Debug, Error)]
enum CompileFailure {
    #[error("the fixture directory cannot be read: {0}")]
    Reader(#[from] FsReaderError),
    #[error("{0}")]
    Internal(#[from] InternalError),
}

/// The compiler the oracle checks.
#[derive(Debug, Clone, Copy, Default)]
pub struct CompilerSubject;

impl OracleSubject for CompilerSubject {
    fn compile(&self, fixture: &Fixture) -> SubjectAnswer<Compilation> {
        match compile_fixture(fixture) {
            Ok(answer) => answer,
            Err(failure) => SubjectAnswer::InternalError {
                message: failure.to_string(),
            },
        }
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
        RuleIdRegistry {
            stages: vec![StageRuleIds {
                stage: LOAD_STAGE,
                rule_ids: LoadRule::RULE_IDS,
            }],
            porting: StagePorting::Partial,
        }
    }
}

/// Loads the fixture; a load that reports an error is the whole answer, anything past it is not
/// ported.
fn compile_fixture(fixture: &Fixture) -> Result<SubjectAnswer<Compilation>, CompileFailure> {
    let reader = FsReader::new(&fixture.directory)?;
    let output = load_workspace(&LoadOptions {
        reader: &reader,
        entry: &fixture.entry,
    })?;
    let stopped = output
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == Severity::Error);

    if !stopped {
        return Ok(SubjectAnswer::NotPorted);
    }

    let no_apis: [ApiDiagnostics<'_>; 0] = [];

    Ok(SubjectAnswer::Ported(Compilation {
        diagnostics: diagnostics_json(&output.diagnostics, &no_apis),
        apis: Vec::new(),
    }))
}
