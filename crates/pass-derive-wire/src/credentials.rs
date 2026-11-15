//! The credential parameters of the accepted schemes (`identity.authenticate`) and the CSRF header
//! parameter (`csrf.cookieWrite`), ADR 0006 section 5. A credential is a parameter only where it
//! is a header or a query value: a header or query scheme by its name, bearer and basic as
//! `Authorization`, a signature scheme by its header name. A cookie is no parameter. A credential
//! is required only when it is the single scheme of a non-optional access.
//!
//! The CSRF decision is access.identity's (`Operation.csrf`); this half writes its header
//! parameter, required only on identity access when every accepted scheme is a cookie that
//! declares CSRF.

use seampact_diagnostics::InternalError;
use seampact_ir::{Csrf, DerivationId, DerivedFrom, KnownAccessRef, KnownSchemeRef, Origin};

use crate::params::{
    DeriveWireDerived, DeriveWireParamPlace, derive_wire_add_param, derive_wire_string_use,
};
use crate::routes::{DeriveWireRoute, DeriveWireScope, derive_wire_access_of};

const AUTHORIZATION: &str = "Authorization";

const AUTHENTICATE: DerivationId = DerivationId::from_static("identity.authenticate");

/// The accesses that carry credentials.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DeriveWireCredentialAccess {
    Identity,
    Optional,
}

/// Where a scheme's credential travels as a parameter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DeriveWireCredentialPlace {
    pub(crate) place: DeriveWireParamPlace,
    pub(crate) name: String,
}

/// Writes the credential and CSRF parameters of the route's access.
///
/// # Errors
///
/// An internal error for a scheme the draft lacks.
pub(crate) fn derive_wire_credentials(
    route: &DeriveWireRoute,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let (access_kind, scheme_ids, access_origin) = match derive_wire_access_of(scope, route)? {
        KnownAccessRef::Public(_) => return Ok(()),
        KnownAccessRef::Identity(access) => (
            DeriveWireCredentialAccess::Identity,
            &access.schemes,
            &access.origin,
        ),
        KnownAccessRef::Optional(access) => (
            DeriveWireCredentialAccess::Optional,
            &access.schemes,
            &access.origin,
        ),
    };
    let schemes = scheme_ids
        .iter()
        .map(|id| derive_wire_scheme_of(id.as_str(), scope))
        .collect::<Result<Vec<_>, InternalError>>()?;
    let required = access_kind == DeriveWireCredentialAccess::Identity && schemes.len() == 1;

    for scheme in &schemes {
        let Some(place) = derive_wire_credential_place(*scheme)? else {
            continue;
        };

        derive_wire_add_param(
            route,
            place.place,
            DeriveWireDerived {
                name: place.name,
                r#type: derive_wire_string_use(),
                required,
                derived_from: DerivedFrom {
                    derivation: AUTHENTICATE,
                    from: vec![access_origin.clone(), scheme_origin(*scheme).clone()],
                },
                wire: None,
            },
            scope,
        )?;
    }

    write_csrf_param(route, access_kind, &schemes, scope)
}

fn scheme_origin(scheme: KnownSchemeRef<'_>) -> &Origin {
    match scheme {
        KnownSchemeRef::Cookie(scheme) => &scheme.origin,
        KnownSchemeRef::Header(scheme) => &scheme.origin,
        KnownSchemeRef::Query(scheme) => &scheme.origin,
        KnownSchemeRef::Bearer(scheme) => &scheme.origin,
        KnownSchemeRef::Basic(scheme) => &scheme.origin,
        KnownSchemeRef::Signature(scheme) => &scheme.origin,
    }
}

fn write_csrf_param(
    route: &DeriveWireRoute,
    access_kind: DeriveWireCredentialAccess,
    schemes: &[KnownSchemeRef<'_>],
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let Some(Csrf::Derived(csrf)) = &scope.operation_of(route.operation)?.csrf else {
        return Ok(());
    };
    let every_cookie_checked = schemes
        .iter()
        .all(|scheme| matches!(scheme, KnownSchemeRef::Cookie(cookie) if cookie.csrf.is_some()));

    derive_wire_add_param(
        route,
        DeriveWireParamPlace::Header,
        DeriveWireDerived {
            name: csrf.header.clone(),
            r#type: derive_wire_string_use(),
            required: access_kind == DeriveWireCredentialAccess::Identity && every_cookie_checked,
            derived_from: csrf.derived_from.clone(),
            wire: None,
        },
        scope,
    )
}

/// Where a scheme's credential travels as a parameter: a header or a query value; a cookie is
/// none.
///
/// # Errors
///
/// An internal error for a signature scheme without its header name.
pub(crate) fn derive_wire_credential_place(
    scheme: KnownSchemeRef<'_>,
) -> Result<Option<DeriveWireCredentialPlace>, InternalError> {
    let place = |place, name: &str| {
        Some(DeriveWireCredentialPlace {
            place,
            name: name.to_owned(),
        })
    };

    match scheme {
        KnownSchemeRef::Header(scheme) => Ok(place(DeriveWireParamPlace::Header, &scheme.name)),
        KnownSchemeRef::Query(scheme) => Ok(place(DeriveWireParamPlace::Query, &scheme.name)),
        KnownSchemeRef::Bearer(_) | KnownSchemeRef::Basic(_) => {
            Ok(place(DeriveWireParamPlace::Header, AUTHORIZATION))
        }
        KnownSchemeRef::Signature(scheme) => scheme
            .name
            .as_deref()
            .map(|name| place(DeriveWireParamPlace::Header, name))
            .ok_or_else(|| {
                InternalError::new(format!(
                    "access.identity wrote signature scheme '{}' without its header name",
                    scheme.id
                ))
            }),
        KnownSchemeRef::Cookie(_) => Ok(None),
    }
}

/// A scheme of the draft by id; access.identity wrote every scheme an access names.
///
/// # Errors
///
/// An internal error for an id that is no scheme, or a scheme of a kind this compiler lacks.
pub(crate) fn derive_wire_scheme_of<'draft>(
    id: &str,
    scope: &DeriveWireScope<'draft, '_, '_>,
) -> Result<KnownSchemeRef<'draft>, InternalError> {
    let draft = scope.draft;
    let scheme = draft.schemes.get(id).ok_or_else(|| {
        InternalError::new(format!(
            "access.identity wrote an access naming scheme '{id}', which is no scheme"
        ))
    })?;

    Ok(KnownSchemeRef::try_from(scheme)?)
}
