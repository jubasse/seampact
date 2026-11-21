//! The recorded calls of the CLI cases: config readers, editor schemas, bundle fetch.

use camino::Utf8Path;
use seampact_oracle::{RecordedAnswer, RecordedToolCall, RecordedUnit, SubjectAnswer};

/// Replays `call` of `unit` on `root`. The brief that ports each recorded function reads its
/// arguments and converts its result here.
pub(crate) fn recorded_answer(
    unit: RecordedUnit,
    _call: &RecordedToolCall,
    _root: &Utf8Path,
) -> SubjectAnswer<RecordedAnswer> {
    match unit {
        RecordedUnit::CliConfig | RecordedUnit::EditorSchemas | RecordedUnit::BundleFetch => {
            SubjectAnswer::NotPorted
        }
    }
}
