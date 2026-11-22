//! The comparison of the operations of the two IRs.

use crate::DiffError;
use crate::not_ported::not_ported_yet;
use crate::walk_context::WalkContext;

/// Compares the operations of the two IRs.
///
/// # Errors
///
/// Not ported yet.
pub(crate) fn compare_operations(_context: &mut WalkContext<'_>) -> Result<(), DiffError> {
    Err(not_ported_yet("compareOperations"))
}
