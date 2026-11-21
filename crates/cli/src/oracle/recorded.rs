//! The recorded calls of the CLI cases, dispatched to one wiring module per recorded unit.

mod bundle_fetch;
mod cli_config;
mod editor_schemas;

use camino::Utf8Path;
use seampact_oracle::{RecordedAnswer, RecordedToolCall, RecordedUnit, SubjectAnswer};

/// Replays `call` of `unit` on `root`, through the wiring module of `unit`.
pub(crate) fn recorded_answer(
    unit: RecordedUnit,
    call: &RecordedToolCall,
    root: &Utf8Path,
) -> SubjectAnswer<RecordedAnswer> {
    match unit {
        RecordedUnit::CliConfig => cli_config::cli_config_answer(call, root),
        RecordedUnit::EditorSchemas => editor_schemas::editor_schemas_answer(call, root),
        RecordedUnit::BundleFetch => bundle_fetch::bundle_fetch_answer(call, root),
    }
}
