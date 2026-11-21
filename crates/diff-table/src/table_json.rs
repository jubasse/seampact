//! The diff codes and the change table as one JSON value, for the oracle.

use seampact_json::JsonValue;

use crate::DiffTableError;
use crate::not_ported::not_ported_yet;

/// `{ "codes": DIFF_CODES, "table": DIFF_TABLE }` as `JSON.stringify` writes them.
///
/// # Errors
///
/// [`DiffTableError::NotPortedYet`] until the table is ported.
pub fn diff_table_json() -> Result<JsonValue, DiffTableError> {
    Err(not_ported_yet("DIFF_TABLE"))
}
