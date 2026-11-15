//! The headers of the bodies beyond JSON (A39, ADR 0002 section 7, ADR 0006 section 5); their
//! `binary` and `redirect` shapes are tree.nodes'. `response.download`: a response whose body is a
//! file answers the required `Content-Type`, one of the file's media, and the optional
//! `Content-Disposition`. `redirect.location`: a 301, 302, 303, 307 or 308 answers the required
//! `Location`, a `uri-reference`.

use seampact_ir::{DerivationId, Origin, Response, ScalarType, TypeUse};
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;
use crate::params::{derive_wire_no_refinements, derive_wire_scalar_use};
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
/// [`PassError::NotPortedYet`] until the header writers are ported.
pub(crate) fn derive_wire_body_headers(
    route: &DeriveWireRoute,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
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
    _route: &DeriveWireRoute,
    _response: usize,
    _header: &BodyHeader,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("add"))
}

// The response as written, else the route that declares it as its output.
fn origin_of(
    _route: &DeriveWireRoute,
    _response: &Response,
    _scope: &DeriveWireScope<'_, '_, '_>,
) -> Result<Origin, PassError> {
    Err(not_ported_yet("originOf"))
}
