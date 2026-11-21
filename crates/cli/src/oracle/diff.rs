//! The diff cases: the codes and table, and the diff of two compiled fixtures.

use seampact_diff_table::diff_table_json;
use seampact_json::JsonValue;
use seampact_oracle::{DiffAnswer, DiffCase, SubjectAnswer};

use crate::oracle::stub_answer::failed_answer;

/// The diff codes and table, `{ "codes", "table" }`.
pub(crate) fn diff_table_answer() -> SubjectAnswer<JsonValue> {
    match diff_table_json() {
        Ok(table) => SubjectAnswer::Ported(table),
        Err(error) => failed_answer(&error),
    }
}

/// Compiles both sides of `case` and diffs them. The brief that ports `diffContracts` compiles
/// the sides and converts the result here.
pub(crate) fn diff_answer(_case: &DiffCase) -> SubjectAnswer<DiffAnswer> {
    SubjectAnswer::NotPorted
}
