//! The lint cases: the diagnostics of one compiled api.

use seampact_json::JsonValue;
use seampact_oracle::{Fixture, SubjectAnswer};

/// Lints `api` of `fixture`. The brief that ports `runLint` compiles the fixture and converts the
/// diagnostics here.
pub(crate) fn lint_answer(_fixture: &Fixture, _api: &str) -> SubjectAnswer<JsonValue> {
    SubjectAnswer::NotPorted
}
