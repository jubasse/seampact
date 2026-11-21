//! The parameters of an operation.

use seampact_ir::{DerivationId, Operation, Param};
use seampact_json::JsonObject;
use seampact_pass_access_identity::CSRF_DERIVATION;
use seampact_pass_derive_wire::AUTHENTICATE;
use seampact_target::IrLocation;

use crate::OpenApiError;
use crate::emit_context::EmitContext;
use crate::not_ported::not_ported_yet;

/// The derivation of the CSRF header parameter.
const CSRF_COOKIE_WRITE_DERIVATION: DerivationId = DerivationId::from_static(CSRF_DERIVATION);

/// The derivations that write a credential parameter, which the security schemes carry instead.
const SCHEME_DERIVATIONS: [DerivationId; 2] = [AUTHENTICATE, CSRF_COOKIE_WRITE_DERIVATION];

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

fn parameter_object(
    _context: &mut EmitContext<'_>,
    _operation: &Operation,
    _place: ParameterPlace,
    _param: &Param,
    _location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("parameterObject"))
}
