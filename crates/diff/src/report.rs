//! The text report of a diff.

use seampact_diff_table::DiffResult;

use crate::DiffError;
use crate::not_ported::not_ported_yet;

/// The report `seampact diff` prints for `result`.
///
/// # Errors
///
/// [`DiffError::NotPortedYet`] until the function is ported.
pub fn format_diff_report(_result: &DiffResult) -> Result<String, DiffError> {
    Err(not_ported_yet("formatDiffReport"))
}
