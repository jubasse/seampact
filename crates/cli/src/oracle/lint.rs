//! The lint cases: the diagnostics of one compiled api.

use indexmap::IndexMap;
use seampact_compiler::{PipelineOptions, compile_workspace};
use seampact_diagnostics::diagnostic_list_json;
use seampact_json::JsonValue;
use seampact_lint::{RunLintInput, run_lint};
use seampact_load::{FsReader, LoadOptions};
use seampact_oracle::{Fixture, SubjectAnswer};

/// Compiles `fixture` and lints its api `api`.
pub(crate) fn lint_answer(fixture: &Fixture, api: &str) -> SubjectAnswer<JsonValue> {
    match lint_diagnostics(fixture, api) {
        Ok(diagnostics) => SubjectAnswer::Ported(diagnostics),
        Err(message) => SubjectAnswer::InternalError { message },
    }
}

fn lint_diagnostics(fixture: &Fixture, api: &str) -> Result<JsonValue, String> {
    let reader = FsReader::new(&fixture.directory).map_err(|error| error.to_string())?;
    let no_imports = IndexMap::new();
    let options = PipelineOptions {
        load: LoadOptions {
            reader: &reader,
            entry: &fixture.entry,
        },
        imports: &no_imports,
    };
    let result = compile_workspace(&options).map_err(|error| error.to_string())?;
    let compiled = result
        .apis
        .iter()
        .find(|compiled| compiled.api == api)
        .ok_or_else(|| format!("the fixture does not compile the api '{api}'"))?;
    let (Some(ir), Some(declared)) = (&compiled.ir, &compiled.declared) else {
        return Err(format!("the api '{api}' has no IR to lint"));
    };
    let input = RunLintInput {
        ir,
        declared,
        locations: &compiled.locations,
        source_files: &result.source_files,
    };
    let diagnostics = run_lint(&input).map_err(|error| error.to_string())?;

    Ok(diagnostic_list_json(&diagnostics))
}
