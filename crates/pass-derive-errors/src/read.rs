//! Readers of the merged raw tree: the authoring schema has already checked every shape (the
//! validate stage stops the pipeline otherwise), so a reader only narrows the JSON types.

use seampact_diagnostics::InternalError;
use seampact_ir::{Docs, Origin};
use seampact_json::{JsonObject, JsonValue};

use crate::report::DeriveErrorsContext;

/// An own member of a raw mapping; `None` when absent.
pub(crate) fn derive_errors_member<'raw>(
    object: &'raw JsonObject,
    key: &str,
) -> Option<&'raw JsonValue> {
    object.get(key)
}

/// A string member; `None` when absent or of another type.
pub(crate) fn derive_errors_string<'raw>(object: &'raw JsonObject, key: &str) -> Option<&'raw str> {
    match derive_errors_member(object, key) {
        Some(JsonValue::String(text)) => Some(text.as_str()),
        _ => None,
    }
}

/// The entries of a mapping whose values are mappings, in written order.
pub(crate) fn derive_errors_entries(catalogue: Option<&JsonValue>) -> Vec<(&str, &JsonObject)> {
    let Some(JsonValue::Object(entries)) = catalogue else {
        return Vec::new();
    };

    entries
        .iter()
        .filter_map(|(name, value)| match value {
            JsonValue::Object(entry) => Some((name.as_str(), entry)),
            _ => None,
        })
        .collect()
}

/// The `docs` of a declaration: its written `summary` and `description`.
pub(crate) fn derive_errors_docs(declaration: &JsonObject) -> Docs {
    Docs {
        summary: derive_errors_string(declaration, "summary").map(str::to_owned),
        description: derive_errors_string(declaration, "description").map(str::to_owned),
    }
}

/// The origin of a node of the merged raw tree the half read, copied for the draft.
///
/// # Errors
///
/// An internal error when the node has no origin.
pub(crate) fn derive_errors_origin_of(
    context: DeriveErrorsContext<'_>,
    pointer: &str,
) -> Result<Origin, InternalError> {
    context.origin(pointer).ok_or_else(|| {
        InternalError::new(format!(
            "derive.errors read {pointer}, which has no origin in the merged raw tree"
        ))
    })
}
