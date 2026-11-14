//! Value sources in their IR form: this half reads the named forms only (a signature key, a
//! header use's `from`, a binding).

use seampact_ir::ValueSource;
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;

/// The named value sources this half reads.
pub(crate) const NAMED_SOURCES: &[&str] =
    &["path", "query", "header", "body", "principal", "scope"];

pub(crate) fn is_named_source(_text: &str) -> Result<bool, PassError> {
    Err(not_ported_yet("isNamedSource"))
}

/// The IR form of a named value source (`path.workspaceId`, `principal.profile.id`).
pub(crate) fn access_identity_value_source(_text: &str) -> Result<ValueSource, PassError> {
    Err(not_ported_yet("accessIdentityValueSource"))
}
