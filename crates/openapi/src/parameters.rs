//! The parameters of an operation.

use seampact_ir::{DerivationId, HeaderSemantic, HeaderSide, Operation, Param, derivation_ids};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::IrLocation;

use crate::emit_context::{EmitContext, SchemaVariant, write_extension};
use crate::json_value::set_defined;
use crate::paging::paging_limit_default;
use crate::schemas::{type_use_schema, wire_value};
use crate::{ExtensionName, OpenApiError};

/// The suffix of the name of a bracketed list parameter.
const BRACKETS_SUFFIX: &str = "[]";

/// The derivations that write a credential parameter, which the security schemes carry instead.
const SCHEME_DERIVATIONS: [DerivationId; 2] = [
    derivation_ids::IDENTITY_AUTHENTICATE,
    derivation_ids::CSRF_COOKIE_WRITE,
];

/// Whether a parameter is a credential a security scheme writes.
fn written_by_security(param: &Param) -> bool {
    param
        .derived_from
        .as_ref()
        .is_some_and(|derived| SCHEME_DERIVATIONS.contains(&derived.derivation))
}

/// Where a parameter travels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ParameterPlace {
    /// A path segment.
    Path,
    /// A query member.
    Query,
    /// A request header.
    Header,
}

impl ParameterPlace {
    /// The place as the IR and OpenAPI write it.
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Path => "path",
            Self::Query => "query",
            Self::Header => "header",
        }
    }
}

/// The parameters of an operation: path, query, then header, those a security scheme writes left out.
pub(crate) fn operation_parameters(
    context: &mut EmitContext<'_>,
    operation: &Operation,
    location: &IrLocation,
) -> Result<Vec<JsonObject>, OpenApiError> {
    let places = [
        (ParameterPlace::Path, &operation.params.path),
        (ParameterPlace::Query, &operation.params.query),
        (ParameterPlace::Header, &operation.params.header),
    ];
    let mut parameters = Vec::new();

    for (place, params) in places {
        for (index, param) in params.iter().enumerate() {
            if written_by_security(param) {
                continue;
            }

            let param_location = location.below(&["params", place.as_str(), &index.to_string()]);

            parameters.push(parameter_object(
                context,
                operation,
                place,
                param,
                &param_location,
            )?);
        }
    }

    Ok(parameters)
}

/// The parameter object of one parameter: its place, schema, default and identity semantic.
///
/// # Errors
///
/// As the writers of the type use schema and of the wire value of a default.
fn parameter_object(
    context: &mut EmitContext<'_>,
    operation: &Operation,
    place: ParameterPlace,
    param: &Param,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    let brackets = param.wire.as_ref().is_some_and(|wire| wire.brackets);
    let name = if brackets {
        format!("{}{BRACKETS_SUFFIX}", param.name)
    } else {
        param.name.clone()
    };
    let mut parameter = JsonObject::from_members([
        ("name", JsonValue::text(&name)),
        ("in", JsonValue::text(place.as_str())),
        ("required", JsonValue::Bool(param.required)),
    ]);

    if let Some(wire) = &param.wire {
        parameter.insert("style".to_owned(), JsonValue::text(wire.style.as_str()));
        parameter.insert("explode".to_owned(), JsonValue::Bool(wire.explode));
    }

    let mut schema = type_use_schema(
        context,
        &param.r#type,
        SchemaVariant::Shared,
        &location.below(&["type"]),
    )?;
    let default_value = match &param.default {
        None => paging_limit_default(context, operation, place, &param.name),
        Some(default) => Some(wire_value(context, &param.r#type, default)?),
    };

    set_defined(&mut schema, "default", default_value);
    parameter.insert("schema".to_owned(), JsonValue::Object(schema));

    if place == ParameterPlace::Header
        && let Some(semantic) = identity_header_semantic(context, &param.name)
    {
        write_extension(
            context,
            &mut parameter,
            ExtensionName::Semantic,
            JsonValue::text(semantic),
        );
    }

    Ok(parameter)
}

/// The semantic of the identity header named `header_name`, compared without case.
fn identity_header_semantic<'ir>(
    context: &EmitContext<'ir>,
    header_name: &str,
) -> Option<&'ir str> {
    let lower_name = header_name.to_lowercase();

    context
        .ir
        .headers
        .values()
        .find(|header| {
            let request_name = if header.semantic == HeaderSemantic::VersionToken {
                header.request.as_deref()
            } else {
                header.name.as_deref()
            };

            request_name.is_some_and(|name| name.to_lowercase() == lower_name)
                && header.r#in != Some(HeaderSide::Response)
        })
        .map(|header| header.semantic.as_str())
}
