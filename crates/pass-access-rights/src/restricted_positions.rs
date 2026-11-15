//! The positions a field restriction is refused at: route params, headers and error params.

use seampact_diagnostics::{InternalError, access_rights_quoted};
use seampact_ir::{Direction, KnownSchemaRef, KnownTypeUse, Layer, Origin, RefTypeUse, TypeUse};
use seampact_pipeline::{PassError, pointer_below};

use crate::read::{access_rights_entries, access_rights_member};
use crate::restricted_fields::{
    AccessRightsDraftSchemas, AccessRightsPositionWalk, AccessRightsRefusedPosition,
    access_rights_refuse_restrictions_below,
};
use crate::routes::{AccessRightsRoute, access_rights_operation_of};
use crate::schema_use::AccessRightsContext;

/// The pointer of an origin a diagnostic can point at; a derived position has a core origin,
/// which it cannot.
pub(crate) fn authored_pointer(origin: Option<&Origin>) -> Option<&str> {
    let origin = origin?;

    (origin.layer != Layer::Core).then_some(origin.pointer.as_str())
}

pub(crate) fn optional_pointer(pointer: Option<&str>) -> Option<String> {
    pointer.map(str::to_owned)
}

/// Refuses a restricted field reached from the route's query parameters, request headers or
/// response headers.
pub(crate) fn access_rights_refuse_route_positions(
    context: &AccessRightsContext,
    walk: &mut AccessRightsPositionWalk<'_, '_>,
    route: &AccessRightsRoute,
) -> Result<(), PassError> {
    let operation = access_rights_operation_of(context, route)?;
    let mut positions: Vec<(&str, &TypeUse, Option<&Origin>, &str)> = Vec::new();

    if let Some(params) = &operation.params {
        for parameter in &params.query {
            positions.push((
                &parameter.name,
                &parameter.r#type,
                parameter.origin.as_ref(),
                "query parameter",
            ));
        }

        for header in &params.header {
            positions.push((
                &header.name,
                &header.r#type,
                header.origin.as_ref(),
                "request header",
            ));
        }
    }

    for response in operation.responses.iter().flatten() {
        for header in &response.headers {
            positions.push((
                &header.name,
                &header.r#type,
                header.origin.as_ref(),
                "response header",
            ));
        }
    }

    for (name, type_use, origin, kind) in positions {
        let position = AccessRightsRefusedPosition {
            text: format!(
                "{kind} '{}' of route '{}'",
                access_rights_quoted(name),
                route.id
            ),
            pointer: optional_pointer(authored_pointer(origin)),
        };

        access_rights_refuse_restrictions_below(walk, type_use, &position)?;
    }

    Ok(())
}

/// Refuses a restricted field reached from the params of an error the contract declares, whatever
/// route answers it.
pub(crate) fn access_rights_refuse_error_params(
    context: &AccessRightsContext,
    walk: &mut AccessRightsPositionWalk<'_, '_>,
) -> Result<(), PassError> {
    let merged = Some(&context.context.raw.merged);

    for (code, error) in access_rights_entries(merged, "errors") {
        if access_rights_member(Some(error), "params").is_none() {
            continue;
        }

        let pointer = pointer_below("/errors", &[code, "params"]);
        let position = AccessRightsRefusedPosition {
            text: format!("the params of error '{}'", access_rights_quoted(code)),
            pointer: Some(pointer.clone()),
        };
        let params_use = error_params_use(context, walk.schemas, &pointer)?;

        access_rights_refuse_restrictions_below(walk, &params_use, &position)?;
    }

    Ok(())
}

/// The params of a default code the layer redeclares take the code's reserved schema id, which
/// the schema service does not answer for that position: that schema is found by its origin.
pub(crate) fn error_params_use(
    context: &AccessRightsContext,
    schemas: &AccessRightsDraftSchemas,
    pointer: &str,
) -> Result<TypeUse, PassError> {
    if let Some(answered) = context.schemas.type_use(pointer, Direction::Output)? {
        return Ok(answered);
    }

    for schema in schemas.values() {
        let (id, origin) = match KnownSchemaRef::try_from(schema)? {
            KnownSchemaRef::Object(object) => (&object.id, &object.origin),
            KnownSchemaRef::Map(map) => (&map.id, &map.origin),
            KnownSchemaRef::Union(union) => (&union.id, &union.origin),
        };

        if origin.layer != Layer::Core && origin.pointer == pointer {
            return Ok(KnownTypeUse::Ref(RefTypeUse {
                schema: id.clone(),
                unknown_keys: None,
                nullable: None,
                docs: None,
                examples: None,
            })
            .into());
        }
    }

    Err(InternalError::new(format!(
        "tree.schemas compiled no schema for the error params written at {pointer}"
    ))
    .into())
}
