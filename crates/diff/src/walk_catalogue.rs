//! The comparison of the schema, scalar and enum catalogues.

use crate::DiffError;
use crate::not_ported::not_ported_yet;
use crate::walk_context::WalkContext;

/// Compares the schemas of the two IRs.
///
/// # Errors
///
/// Not ported yet.
pub(crate) fn compare_schema_catalogue(_context: &mut WalkContext<'_>) -> Result<(), DiffError> {
    Err(not_ported_yet("compareSchemaCatalogue"))
}

/// Compares the scalars of the two IRs.
///
/// # Errors
///
/// Not ported yet.
pub(crate) fn compare_scalar_catalogue(_context: &mut WalkContext<'_>) -> Result<(), DiffError> {
    Err(not_ported_yet("compareScalarCatalogue"))
}

/// Compares the enums of the two IRs.
///
/// # Errors
///
/// Not ported yet.
pub(crate) fn compare_enum_catalogue(_context: &mut WalkContext<'_>) -> Result<(), DiffError> {
    Err(not_ported_yet("compareEnumCatalogue"))
}
