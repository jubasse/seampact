//! The lifecycle members derived from settings tree.nodes wrote (ADR 0002 section 10, ADR 0006
//! section 5). `deprecation.headers`: a deprecated operation answers every success with the
//! deprecation and sunset headers, and the successor `Link` when it names one. `upstream.maturity`:
//! an operation with no stated maturity takes its owning service's (the first of `upstream`), else
//! the api's, located at the api's `maturity`, or at the api itself when its maturity is the
//! default.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    DerivationId, DerivedFrom, MaturitySource, OperationMaturity, ResponseHeaderSemantic,
};
use seampact_pipeline::{ConventionReading, PassError};

use crate::not_ported::not_ported_yet;
use crate::params::{
    DERIVE_WIRE_LINK, DeriveWireDerived, derive_wire_add_success_header, derive_wire_string_use,
};
use crate::routes::{DeriveWireRoute, DeriveWireScope};

const DEPRECATION: DerivationId = DerivationId::from_static("deprecation.headers");

struct DeprecationHeader<'run> {
    name: String,
    semantic: ResponseHeaderSemantic,
    naming: Option<ConventionReading<'run>>,
}

/// Writes the deprecation, sunset and successor `Link` response headers of a deprecated operation.
///
/// # Errors
///
/// An internal error from a convention reading, or [`PassError::NotPortedYet`] until the header
/// writers are ported.
pub(crate) fn derive_wire_deprecation(
    route: &DeriveWireRoute,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let Some(deprecated) = &scope.operation_of(route.operation)?.deprecated else {
        return Ok(());
    };
    let conventions = scope.context.conventions;
    let header = conventions.get("deprecation.header")?;
    let sunset_header = conventions.get("deprecation.sunsetHeader")?;
    let mut headers = vec![
        DeprecationHeader {
            name: text_of(header.as_ref())?,
            semantic: ResponseHeaderSemantic::Deprecation,
            naming: header,
        },
        DeprecationHeader {
            name: text_of(sunset_header.as_ref())?,
            semantic: ResponseHeaderSemantic::Sunset,
            naming: sunset_header,
        },
    ];

    if deprecated.successor.is_some() {
        headers.push(DeprecationHeader {
            name: DERIVE_WIRE_LINK.to_owned(),
            semantic: ResponseHeaderSemantic::SuccessorLink,
            naming: conventions.get("deprecation.successorRel")?,
        });
    }

    for DeprecationHeader {
        name,
        semantic,
        naming,
    } in headers
    {
        let mut from = vec![deprecated.origin.clone()];

        from.extend(naming.and_then(|reading| reading.origin));

        derive_wire_add_success_header(
            route,
            &DeriveWireDerived {
                name,
                r#type: derive_wire_string_use(),
                required: true,
                derived_from: DerivedFrom {
                    derivation: DEPRECATION,
                    from,
                },
                wire: None,
            },
            Some(&semantic),
            scope,
        )?;
    }

    Ok(())
}

/// Writes the derived `maturity` of an operation that states none.
///
/// # Errors
///
/// An internal error for an upstream service or an api the draft lacks.
pub(crate) fn derive_wire_maturity(
    route: &DeriveWireRoute,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let operation = scope.operation_of(route.operation)?;

    if operation.maturity.is_some() {
        return Ok(());
    }

    let draft = scope.draft;
    let maturity = if let Some(owner) = operation
        .upstream
        .as_ref()
        .and_then(|owners| owners.first())
    {
        let service = draft.services.get(owner.as_str()).ok_or_else(|| {
            InternalError::new(format!(
                "tree.nodes wrote upstream service '{owner}' on '{}', which is no service",
                route.id
            ))
        })?;

        OperationMaturity {
            level: service.maturity.clone(),
            source: MaturitySource::Upstream,
            reason: None,
            origin: service.origin.clone(),
        }
    } else {
        let api = draft
            .api
            .as_ref()
            .ok_or_else(|| InternalError::new("tree.nodes wrote no api".to_owned()))?;
        let origin = scope
            .context
            .origin("/api/maturity")
            .unwrap_or_else(|| api.origin.clone());

        OperationMaturity {
            level: api.maturity.clone(),
            source: MaturitySource::Api,
            reason: None,
            origin,
        }
    };

    scope.output_of(route.operation)?.maturity = Some(maturity);

    Ok(())
}

fn text_of(_reading: Option<&ConventionReading<'_>>) -> Result<String, PassError> {
    Err(not_ported_yet("textOf"))
}
