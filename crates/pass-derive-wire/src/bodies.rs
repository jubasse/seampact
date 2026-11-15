//! The headers of the bodies beyond JSON (A39, ADR 0002 section 7, ADR 0006 section 5); their
//! `binary` and `redirect` shapes are tree.nodes'. `response.download`: a response whose body is a
//! file answers the required `Content-Type`, one of the file's media, and the optional
//! `Content-Disposition`. `redirect.location`: a 301, 302, 303, 307 or 308 answers the required
//! `Location`, a `uri-reference`.

use seampact_diagnostics::InternalError;
use seampact_ir::{DerivationId, DerivedFrom, Origin, Response, ScalarType, TypeUse};

use crate::params::{
    DeriveWireDerived, derive_wire_add_response_header, derive_wire_no_refinements,
    derive_wire_scalar_use, derive_wire_string_use,
};
use crate::routes::{DeriveWireRoute, DeriveWireScope};

const DOWNLOAD: DerivationId = DerivationId::from_static("response.download");

const REDIRECT: DerivationId = DerivationId::from_static("redirect.location");

const REDIRECT_STATUSES: [i64; 5] = [301, 302, 303, 307, 308];

fn uri_reference_use() -> TypeUse {
    TypeUse::Scalar(derive_wire_scalar_use(
        ScalarType::String,
        Some("uri-reference".to_owned()),
        derive_wire_no_refinements(),
    ))
}

#[derive(Debug, Clone, PartialEq)]
struct BodyHeader {
    name: &'static str,
    required: bool,
    from: Origin,
    derivation: DerivationId,
    r#type: Option<TypeUse>,
}

/// Writes the download and redirect headers of the operation's responses.
///
/// # Errors
///
/// An internal error for an operation without an origin.
pub(crate) fn derive_wire_body_headers(
    route: &DeriveWireRoute,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let responses = scope.responses_of(route.operation)?;

    for (position, response) in responses.iter().enumerate() {
        if !matches!(response.body, Some(TypeUse::File(_))) {
            continue;
        }

        let from = origin_of(route, response, scope)?;

        add(
            route,
            position,
            &BodyHeader {
                name: "Content-Type",
                required: true,
                from: from.clone(),
                derivation: DOWNLOAD,
                r#type: None,
            },
            scope,
        )?;
        add(
            route,
            position,
            &BodyHeader {
                name: "Content-Disposition",
                required: false,
                from,
                derivation: DOWNLOAD,
                r#type: None,
            },
            scope,
        )?;
    }

    for (position, response) in responses.iter().enumerate() {
        if !REDIRECT_STATUSES.contains(&response.status) {
            continue;
        }

        add(
            route,
            position,
            &BodyHeader {
                name: "Location",
                required: true,
                from: origin_of(route, response, scope)?,
                derivation: REDIRECT,
                r#type: Some(uri_reference_use()),
            },
            scope,
        )?;
    }

    Ok(())
}

fn add(
    route: &DeriveWireRoute,
    response: usize,
    header: &BodyHeader,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let derived = DeriveWireDerived {
        name: header.name.to_owned(),
        r#type: header.r#type.clone().unwrap_or_else(derive_wire_string_use),
        required: header.required,
        derived_from: DerivedFrom {
            derivation: header.derivation.clone(),
            from: vec![header.from.clone()],
        },
        wire: None,
    };

    derive_wire_add_response_header(route, response, &derived, None, scope)
}

// The response as written, else the route that declares it as its output.
fn origin_of(
    route: &DeriveWireRoute,
    response: &Response,
    scope: &DeriveWireScope<'_, '_, '_>,
) -> Result<Origin, InternalError> {
    let operation = scope.operation_of(route.operation)?;

    response
        .origin
        .as_ref()
        .or(operation.origin.as_ref())
        .cloned()
        .ok_or_else(|| {
            InternalError::new(format!(
                "tree.nodes wrote no origin on operation '{}'",
                route.id
            ))
        })
}
