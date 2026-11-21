//! The IR's own text forms: origins and derivations as a document writes them.

use seampact_ir::Origin;

use crate::OpenApiError;
use crate::not_ported::not_ported_yet;

/// An origin as the text `[<api>#]<layer>#<pointer>`.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] until the function is ported.
pub(crate) fn origin_key(_origin: &Origin) -> Result<String, OpenApiError> {
    Err(not_ported_yet("originKey"))
}
