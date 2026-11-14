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

pub(crate) fn access_rights_member<'raw>(
    _object: Option<&'raw JsonValue>,
    _key: &str,
) -> Result<Option<&'raw JsonValue>, PassError> {
    Err(not_ported_yet("accessRightsMember"))
}

pub(crate) fn access_rights_string(
    _object: Option<&JsonValue>,
    _key: &str,
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("accessRightsString"))
}

pub(crate) fn access_rights_strings(
    _object: Option<&JsonValue>,
    _key: &str,
) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("accessRightsStrings"))
}

pub(crate) fn access_rights_entries<'raw>(
    _object: Option<&'raw JsonValue>,
    _key: &str,
) -> Result<Vec<(String, &'raw JsonObject)>, PassError> {
    Err(not_ported_yet("accessRightsEntries"))
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
