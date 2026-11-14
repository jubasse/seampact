//! The oracle subject: the compiler as `cargo xtask oracle` runs it over a fixture.
//!
//! It runs the stages that are ported and answers [`SubjectAnswer::NotPorted`] as soon as a run
//! reaches one that is not, so the loader is compared on every fixture whose load stops.

use indexmap::IndexMap;
use seampact_diagnostics::{ApiDiagnostics, InternalError, diagnostics_json};
use seampact_ir::{ContractIr, IrError, SourceMap};
use seampact_json::JsonValue;
use seampact_load::{FsReader, FsReaderError, LoadOptions, LoadRule};
use seampact_oracle::{
    Compilation, CompiledApi, Fixture, HalfInput, OracleSubject, RuleIdRegistry, StagePorting,
    StageRuleIds, SubjectAnswer,
};
use thiserror::Error;

use crate::{PipelineApiResult, PipelineOptions, PipelineResult, PipelineRun, compile_workspace};

mod half;

/// The stage name of the load rules: the second segment of their ids.
const LOAD_STAGE: &str = "load";

/// Why a fixture could not be compiled at all.
#[derive(Debug, Error)]
enum CompileFailure {
    #[error("the fixture directory cannot be read: {0}")]
    Reader(#[from] FsReaderError),
    #[error("{0}")]
    Internal(#[from] InternalError),
    #[error("an IR does not encode: {0}")]
    Encode(#[from] IrError),
}

/// The compiler the oracle checks.
#[derive(Debug, Default)]
pub struct CompilerSubject {
    loaded_fixture: half::LoadedFixtureCache,
}

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
        fixture: &Fixture,
        api: &str,
        half: &str,
        input: &HalfInput<'_>,
    ) -> SubjectAnswer<JsonValue> {
        match half::run_fixture_half(&self.loaded_fixture, fixture, api, half, input) {
            Ok(answer) => answer,
            Err(failure) => SubjectAnswer::InternalError {
                message: failure.to_string(),
            },
        }
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

/// Compiles the fixture, without the `imports` option: a fixture whose workspace declares
/// `imports` is excluded by the oracle.
fn compile_fixture(fixture: &Fixture) -> Result<SubjectAnswer<Compilation>, CompileFailure> {
    let reader = FsReader::new(&fixture.directory)?;
    let no_imports = IndexMap::new();
    let options = PipelineOptions {
        load: LoadOptions {
            reader: &reader,
            entry: &fixture.entry,
        },
        imports: &no_imports,
    };

    match compile_workspace(&options)? {
        PipelineRun::Finished(result) => Ok(SubjectAnswer::Ported(compilation_of(&result)?)),
        PipelineRun::NotPorted(_) => Ok(SubjectAnswer::NotPorted),
    }
}

fn compilation_of(result: &PipelineResult) -> Result<Compilation, IrError> {
    let api_diagnostics: Vec<ApiDiagnostics<'_>> = result
        .apis
        .iter()
        .map(|api| ApiDiagnostics {
            api: &api.api,
            diagnostics: &api.diagnostics,
        })
        .collect();
    let apis = result
        .apis
        .iter()
        .map(compiled_api_of)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Compilation {
        diagnostics: diagnostics_json(&result.diagnostics, &api_diagnostics),
        apis,
    })
}

fn compiled_api_of(api: &PipelineApiResult) -> Result<CompiledApi, IrError> {
    Ok(CompiledApi {
        api: api.api.clone(),
        ir: api
            .ir
            .as_ref()
            .map(ContractIr::canonical_text)
            .transpose()?,
        source_map: api
            .source_map
            .as_ref()
            .map(SourceMap::canonical_text)
            .transpose()?,
    })
}
