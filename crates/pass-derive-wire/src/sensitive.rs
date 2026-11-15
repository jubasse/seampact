//! The sensitive values the responses of the operation carry (ADR 0003 section 6): the walk is the
//! IR invariant's, shared from `seampact-ir`; this adds each value's origin and text, and refuses a
//! schema that tree.schemas did not write. A field of a success body is always no-store; a value
//! elsewhere (a whole body or its items, a map key, a response header) follows
//! `conventions.cache.sensitiveElsewhere`, read by the cache writer.

use seampact_diagnostics::InternalError;
use seampact_ir::{IrMap, IrSensitiveReach, Origin, Schema, SchemaId, find_ir_sensitive_reaches};
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;
use crate::routes::{DeriveWireRoute, DeriveWireScope};

/// A sensitive value a response carries, where it is written and how a message names it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DeriveWireSensitiveValue {
    pub(crate) reach: IrSensitiveReach,
    pub(crate) origin: Origin,
    /// `the sensitive field 'Key.secret'`, `the sensitive header 'X-Token' of a 200 response`.
    pub(crate) text: String,
}

/// The first sensitive field of a body, and the first sensitive value elsewhere, in response order.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DeriveWireSensitive {
    pub(crate) field: Option<DeriveWireSensitiveValue>,
    pub(crate) elsewhere: Option<DeriveWireSensitiveValue>,
}

/// The sensitive values the responses of the operation carry.
///
/// # Errors
///
/// An internal error for a response that references a schema `tree.schemas` did not write.
pub(crate) fn derive_wire_sensitive(
    route: &DeriveWireRoute,
    scope: &DeriveWireScope<'_, '_, '_>,
) -> Result<DeriveWireSensitive, PassError> {
    let responses = scope.responses_of(route.operation)?;
    let reaches = find_ir_sensitive_reaches(&responses, &scope.draft.schemas).map_err(|error| {
        InternalError::new(format!(
            "a response references schema '{}', which tree.schemas did not write",
            error.schema
        ))
    })?;
    let field = reaches
        .iter()
        .find(|reach| matches!(reach, IrSensitiveReach::Field { .. }));
    let elsewhere = reaches
        .iter()
        .find(|reach| !matches!(reach, IrSensitiveReach::Field { .. }));

    Ok(DeriveWireSensitive {
        field: field
            .map(|reach| sensitive_value_of(reach, route, scope))
            .transpose()?,
        elsewhere: elsewhere
            .map(|reach| sensitive_value_of(reach, route, scope))
            .transpose()?,
    })
}

fn sensitive_value_of(
    _reach: &IrSensitiveReach,
    _route: &DeriveWireRoute,
    _scope: &DeriveWireScope<'_, '_, '_>,
) -> Result<DeriveWireSensitiveValue, PassError> {
    Err(not_ported_yet("sensitiveValueOf"))
}

fn schema_origin(_id: &SchemaId, _schemas: &IrMap<SchemaId, Schema>) -> Result<Origin, PassError> {
    Err(not_ported_yet("schemaOrigin"))
}

fn property_origin(
    _schema: &SchemaId,
    _property: &str,
    _schemas: &IrMap<SchemaId, Schema>,
) -> Result<Origin, PassError> {
    Err(not_ported_yet("propertyOrigin"))
}
