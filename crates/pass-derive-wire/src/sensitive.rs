//! The sensitive values the responses of the operation carry (ADR 0003 section 6): the walk is the
//! IR invariant's, shared from `seampact-ir`; this adds each value's origin and text, and refuses a
//! schema that tree.schemas did not write. A field of a success body is always no-store; a value
//! elsewhere (a whole body or its items, a map key, a response header) follows
//! `conventions.cache.sensitiveElsewhere`, read by the cache writer.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    IrMap, IrSensitiveReach, KnownSchemaRef, Origin, Response, Schema, SchemaId,
    find_ir_sensitive_reaches,
};

use crate::routes::{DeriveWireRoute, DeriveWireScope, derive_wire_origin_at};

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
) -> Result<DeriveWireSensitive, InternalError> {
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
            .map(|reach| sensitive_value_of(reach, &responses, route, scope))
            .transpose()?,
        elsewhere: elsewhere
            .map(|reach| sensitive_value_of(reach, &responses, route, scope))
            .transpose()?,
    })
}

fn sensitive_value_of(
    reach: &IrSensitiveReach,
    responses: &[Response],
    route: &DeriveWireRoute,
    scope: &DeriveWireScope<'_, '_, '_>,
) -> Result<DeriveWireSensitiveValue, InternalError> {
    let schemas = &scope.draft.schemas;
    let index = match reach {
        IrSensitiveReach::Field { response, .. }
        | IrSensitiveReach::Body { response }
        | IrSensitiveReach::MapKey { response, .. }
        | IrSensitiveReach::Header { response, .. } => *response,
    };
    let Some(response) = responses.get(index) else {
        return Err(InternalError::new(format!(
            "the sensitive walk named response {index}, which the operation lacks"
        )));
    };

    let (origin, text) = match reach {
        IrSensitiveReach::Field {
            schema, property, ..
        } => (
            property_origin(schema, property, schemas)?,
            format!("the sensitive field '{schema}.{property}'"),
        ),
        IrSensitiveReach::Body { .. } => (
            response_origin(response, route, scope)?,
            format!(
                "a sensitive value as the body of a {} response",
                response.status
            ),
        ),
        IrSensitiveReach::MapKey { schema, .. } => (
            schema_origin(schema, schemas)?,
            format!(
                "the sensitive keys of map '{schema}' in a {} response",
                response.status
            ),
        ),
        IrSensitiveReach::Header { header, .. } => {
            let declared = response
                .headers
                .iter()
                .find(|candidate| candidate.name == *header)
                .and_then(|candidate| candidate.origin.clone());
            let origin = match declared {
                Some(origin) => origin,
                None => response_origin(response, route, scope)?,
            };

            (
                origin,
                format!(
                    "the sensitive header '{header}' of a {} response",
                    response.status
                ),
            )
        }
    };

    Ok(DeriveWireSensitiveValue {
        reach: reach.clone(),
        origin,
        text,
    })
}

// The response as written, else the route that declares it as its output.
fn response_origin(
    response: &Response,
    route: &DeriveWireRoute,
    scope: &DeriveWireScope<'_, '_, '_>,
) -> Result<Origin, InternalError> {
    match &response.origin {
        Some(origin) => Ok(origin.clone()),
        None => derive_wire_origin_at(scope, &scope.node_of(route)?.pointer),
    }
}

fn schema_origin(
    id: &SchemaId,
    schemas: &IrMap<SchemaId, Schema>,
) -> Result<Origin, InternalError> {
    let Some(schema) = schemas.get(id) else {
        return Err(InternalError::new(format!(
            "the sensitive walk named schema '{id}', which is gone"
        )));
    };

    Ok(match KnownSchemaRef::try_from(schema)? {
        KnownSchemaRef::Object(object) => object.origin.clone(),
        KnownSchemaRef::Map(map) => map.origin.clone(),
        KnownSchemaRef::Union(union) => union.origin.clone(),
    })
}

fn property_origin(
    schema: &SchemaId,
    property: &str,
    schemas: &IrMap<SchemaId, Schema>,
) -> Result<Origin, InternalError> {
    let object = match schemas.get(schema).map(KnownSchemaRef::try_from) {
        Some(Ok(KnownSchemaRef::Object(object))) => object,
        Some(Err(error)) => return Err(error.into()),
        Some(Ok(_)) | None => {
            return Err(InternalError::new(format!(
                "the sensitive property '{property}' is not in an object schema"
            )));
        }
    };

    object
        .properties
        .iter()
        .find(|candidate| candidate.name == property)
        .map(|found| found.origin.clone())
        .ok_or_else(|| {
            InternalError::new(format!(
                "schema '{schema}' lost the sensitive property '{property}'"
            ))
        })
}
