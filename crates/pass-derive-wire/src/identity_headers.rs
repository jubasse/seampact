//! The identity headers of the route's identity (FR-28, ADR 0002 section 9, ADR 0006 section 5).
//! Each use applies by its `for` (`all`, `reads` for a safe operation, `writes` otherwise) and its
//! declaration's `in` side: a request parameter or a response header on every success
//! (`identity.header`); a `deadline` request header also names `deadlineHeader`. A `versionToken`
//! use drives two headers (`identity.versionToken`): the response header on every success of every
//! route of the identity, and the request header on writes only. On optional access every request
//! and response header of the identity is optional on the wire. A use's type is its own `schema`,
//! else the declaration's, else a string. versionToken uses are written after every
//! `identity.header` element, so derived elements keep the derivation table's order.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    DerivationId, DerivedFrom, HeaderDecl, HeaderSemantic, HeaderSide, HeaderUseFor,
    IdentityHeaderUse, KnownAccessRef, KnownIdentityRef, ResponseHeaderSemantic,
};

use crate::params::{
    DeriveWireDerived, DeriveWireParamPlace, derive_wire_add_param, derive_wire_add_success_header,
    derive_wire_string_use,
};
use crate::routes::{DeriveWireRoute, DeriveWireScope, derive_wire_access_of};

const HEADER: DerivationId = DerivationId::from_static("identity.header");

const VERSION_TOKEN: DerivationId = DerivationId::from_static("identity.versionToken");

/// A use of a header by an identity, with the declaration it names.
#[derive(Debug, Clone, Copy)]
pub(crate) struct DeriveWireUse<'draft> {
    pub(crate) header_use: &'draft IdentityHeaderUse,
    pub(crate) declaration: &'draft HeaderDecl,
}

/// What `writeVersionToken` reads of the operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DeriveWireVersionTokenFacts {
    pub(crate) safe: bool,
    pub(crate) authenticated: bool,
}

/// Writes the identity header parameters, response headers and `deadlineHeader` of the route.
///
/// # Errors
///
/// An internal error for an identity or header the draft lacks, or a header without its name.
pub(crate) fn derive_wire_identity_headers(
    route: &DeriveWireRoute,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let (identity, authenticated) = match derive_wire_access_of(scope, route)? {
        KnownAccessRef::Public(_) => return Ok(()),
        KnownAccessRef::Identity(access) => (&access.identity, true),
        KnownAccessRef::Optional(access) => (&access.identity, false),
    };
    let operation = scope.operation_of(route.operation)?;
    let Some(safe) = operation.safe else {
        return Err(InternalError::new(format!(
            "tree.nodes wrote no safe on operation '{}'",
            route.id
        )));
    };
    let uses = uses_of(identity.as_str(), scope)?;

    for item in &uses {
        if item.declaration.semantic != HeaderSemantic::VersionToken
            && applies(&item.header_use.r#for, safe)
        {
            write_header(route, item, authenticated, scope)?;
        }
    }

    for item in &uses {
        if item.declaration.semantic == HeaderSemantic::VersionToken {
            write_version_token(
                route,
                item,
                DeriveWireVersionTokenFacts {
                    safe,
                    authenticated,
                },
                scope,
            )?;
        }
    }

    Ok(())
}

pub(crate) fn applies(use_for: &HeaderUseFor, safe: bool) -> bool {
    *use_for == HeaderUseFor::All || (*use_for == HeaderUseFor::Reads) == safe
}

// `authenticated` is false on optional access, where a request may come without a principal.
fn write_header(
    route: &DeriveWireRoute,
    item: &DeriveWireUse<'_>,
    authenticated: bool,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let DeriveWireUse {
        header_use,
        declaration,
    } = item;
    let (Some(name), Some(side)) = (&declaration.name, &declaration.r#in) else {
        return Err(InternalError::new(format!(
            "access.identity wrote header '{}' ({}) without its name or side",
            declaration.id, declaration.semantic
        )));
    };
    let derived = derived_of(name, item, authenticated && header_use.required, HEADER);

    if *side == HeaderSide::Response {
        let semantic = response_semantic_of(&declaration.semantic)?;

        return derive_wire_add_success_header(route, &derived, Some(&semantic), scope);
    }

    derive_wire_add_param(route, DeriveWireParamPlace::Header, derived, scope)?;

    if declaration.semantic == HeaderSemantic::Deadline {
        scope.output_of(route.operation)?.deadline_header = Some(name.clone());
    }

    Ok(())
}

fn write_version_token(
    route: &DeriveWireRoute,
    item: &DeriveWireUse<'_>,
    operation: DeriveWireVersionTokenFacts,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let DeriveWireVersionTokenFacts {
        safe,
        authenticated,
    } = operation;
    let DeriveWireUse {
        header_use,
        declaration,
    } = item;
    let (Some(response), Some(request)) = (&declaration.response, &declaration.request) else {
        return Err(InternalError::new(format!(
            "access.identity wrote versionToken header '{}' without its response or request name",
            declaration.id
        )));
    };
    let semantic = response_semantic_of(&declaration.semantic)?;

    derive_wire_add_success_header(
        route,
        &derived_of(response, item, authenticated, VERSION_TOKEN),
        Some(&semantic),
        scope,
    )?;

    if !safe {
        derive_wire_add_param(
            route,
            DeriveWireParamPlace::Header,
            derived_of(
                request,
                item,
                authenticated && header_use.required,
                VERSION_TOKEN,
            ),
            scope,
        )?;
    }

    Ok(())
}

// The response header semantics are the header declarations' and more: a declaration's own is one
// of them.
fn response_semantic_of(
    semantic: &HeaderSemantic,
) -> Result<ResponseHeaderSemantic, InternalError> {
    ResponseHeaderSemantic::known(semantic.as_str()).ok_or_else(|| {
        InternalError::new(format!(
            "access.identity wrote a header semantic '{semantic}', which no response header carries"
        ))
    })
}

fn derived_of(
    name: &str,
    item: &DeriveWireUse<'_>,
    required: bool,
    derivation: DerivationId,
) -> DeriveWireDerived {
    DeriveWireDerived {
        name: name.to_owned(),
        r#type: item
            .header_use
            .schema
            .as_ref()
            .or(item.declaration.schema.as_ref())
            .cloned()
            .unwrap_or_else(derive_wire_string_use),
        required,
        derived_from: DerivedFrom {
            derivation,
            from: vec![
                item.header_use.origin.clone(),
                item.declaration.origin.clone(),
            ],
        },
        wire: None,
    }
}

fn uses_of<'draft>(
    identity_id: &str,
    scope: &DeriveWireScope<'draft, '_, '_>,
) -> Result<Vec<DeriveWireUse<'draft>>, InternalError> {
    let draft = scope.draft;
    let identity = draft.identities.get(identity_id).ok_or_else(|| {
        InternalError::new(format!(
            "access.identity wrote an access naming identity '{identity_id}', which is no identity"
        ))
    })?;
    let headers = match KnownIdentityRef::try_from(identity)? {
        KnownIdentityRef::Credential(identity) => &identity.headers,
        KnownIdentityRef::Signed(identity) => &identity.headers,
    };

    headers
        .iter()
        .map(|header_use| {
            let declaration = draft
                .headers
                .get(header_use.header.as_str())
                .ok_or_else(|| {
                    InternalError::new(format!(
                        "identity '{identity_id}' uses header '{}', which is no header",
                        header_use.header
                    ))
                })?;

            Ok(DeriveWireUse {
                header_use,
                declaration,
            })
        })
        .collect()
}
