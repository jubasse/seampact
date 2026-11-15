//! Readers of the merged raw tree for the half.

use seampact_ir::{Extensions, Origin};
use seampact_json::{JsonObject, JsonValue};
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;
use crate::schema_use::AccessRightsContext;

/// The written `summary` and `description` of a declaration.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct AccessRightsDocs {
    pub(crate) summary: Option<String>,
    pub(crate) description: Option<String>,
}

/// The value as a mapping; `None` for another type or an absent value.
pub(crate) fn access_rights_object(value: Option<&JsonValue>) -> Option<&JsonObject> {
    match value {
        Some(JsonValue::Object(object)) => Some(object),
        _ => None,
    }
}

/// An own member of a raw mapping; `None` when absent or when `object` is no mapping.
pub(crate) fn access_rights_member<'raw>(
    object: Option<&'raw JsonObject>,
    key: &str,
) -> Option<&'raw JsonValue> {
    object?.get(key)
}

/// A string member; `None` when absent or of another type.
pub(crate) fn access_rights_string<'raw>(
    object: Option<&'raw JsonObject>,
    key: &str,
) -> Option<&'raw str> {
    match access_rights_member(object, key) {
        Some(JsonValue::String(text)) => Some(text.as_str()),
        _ => None,
    }
}

/// The strings of a list member, in written order; an empty list when absent.
pub(crate) fn access_rights_strings(
    _object: Option<&JsonObject>,
    _key: &str,
) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("accessRightsStrings"))
}

/// The entries of a mapping member whose values are mappings, in written order.
pub(crate) fn access_rights_entries<'raw>(
    object: Option<&'raw JsonObject>,
    key: &str,
) -> Vec<(&'raw str, &'raw JsonObject)> {
    let Some(catalogue) = access_rights_object(access_rights_member(object, key)) else {
        return Vec::new();
    };

    catalogue
        .iter()
        .filter_map(|(name, value)| {
            access_rights_object(Some(value)).map(|entry| (name.as_str(), entry))
        })
        .collect()
}

pub(crate) fn access_rights_docs(_declaration: &JsonObject) -> Result<AccessRightsDocs, PassError> {
    Err(not_ported_yet("accessRightsDocs"))
}

pub(crate) fn access_rights_extensions(_declaration: &JsonObject) -> Result<Extensions, PassError> {
    Err(not_ported_yet("accessRightsExtensions"))
}

pub(crate) fn access_rights_origin_of(
    _context: &AccessRightsContext,
    _pointer: &str,
) -> Result<Origin, PassError> {
    Err(not_ported_yet("accessRightsOriginOf"))
}

pub(crate) fn access_rights_schema_name(
    _value: Option<&JsonValue>,
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("accessRightsSchemaName"))
}
