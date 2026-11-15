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
    HeaderDecl, HeaderSemantic, HeaderUseFor, IdentityHeaderUse, KnownAccessRef, KnownIdentityRef,
};
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;
use crate::params::DeriveWireDerived;
use crate::routes::{DeriveWireRoute, DeriveWireScope, derive_wire_access_of};

const HEADER: &str = "identity.header";

const VERSION_TOKEN: &str = "identity.versionToken";

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
/// An internal error for an identity or header the draft lacks, or [`PassError::NotPortedYet`]
/// until the header writers are ported.
pub(crate) fn derive_wire_identity_headers(
    route: &DeriveWireRoute,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
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
        ))
        .into());
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
    _route: &DeriveWireRoute,
    _item: &DeriveWireUse<'_>,
    _authenticated: bool,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("writeHeader"))
}

fn write_version_token(
    _route: &DeriveWireRoute,
    _item: &DeriveWireUse<'_>,
    _operation: DeriveWireVersionTokenFacts,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("writeVersionToken"))
}

fn derived_of(
    _name: &str,
    _item: &DeriveWireUse<'_>,
    _required: bool,
    _derivation: &str,
) -> Result<DeriveWireDerived, PassError> {
    Err(not_ported_yet("derivedOf"))
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
