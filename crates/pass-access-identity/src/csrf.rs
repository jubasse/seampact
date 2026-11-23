//! The CSRF decision of an operation (ADR 0002 section 9, ADR 0006 section 5
//! `csrf.cookieWrite`): derived on a non-safe operation whose write schemes include a cookie
//! scheme declaring `csrf` (opt-in, A34), and exempt there where the nearest `csrf: { exempt }`
//! says so. Elsewhere it is absent, an inherited exemption included, since there is no check to
//! exempt: a safe operation (a batch read included), a public route, a route without such a
//! cookie, and a signed identity's route, which never derives it (ADR 0013).

use indexmap::IndexSet;
use seampact_diagnostics::InternalError;
use seampact_ir::{
    CookieScheme, Csrf, DerivedCsrf, DerivedFrom, ExemptCsrf, KnownAccess, KnownIdentityRef,
    KnownScheme, Reason, derivation_ids,
};
use seampact_pipeline::{NearestSetting, pointer_below};

use crate::access::{
    AccessIdentityResolved, AccessIdentityRoute, AccessIdentityScope,
    access_identity_access_schemes, access_identity_id, access_identity_origin_of,
};
use crate::read::{access_identity_is_object, access_identity_string};
use crate::report::{AccessIdentityProblem, AccessIdentityRule};

/// The `csrf` member of an operation; `None` when it has none, or when refused with the error
/// reported.
pub(crate) fn access_identity_csrf(
    route: &AccessIdentityRoute<'_, '_>,
    resolved: &AccessIdentityResolved<'_>,
    scope: &mut AccessIdentityScope<'_, '_, '_, '_>,
) -> Result<Option<Csrf>, InternalError> {
    if route.safe || matches!(resolved.access, KnownAccess::Public(_)) {
        return Ok(None);
    }

    let Some(identity) = resolved.identity else {
        return Ok(None);
    };

    if matches!(identity, KnownIdentityRef::Signed(_)) {
        return Ok(None);
    }

    let built = scope.built;
    let schemes = access_identity_access_schemes(&resolved.access).unwrap_or(&[]);
    let cookies: Vec<&CookieScheme> = schemes
        .iter()
        .filter_map(|id| match built.schemes.get(id) {
            Some(KnownScheme::Cookie(cookie)) if cookie.csrf.is_some() => Some(cookie),
            _ => None,
        })
        .collect();

    if cookies.is_empty() {
        return Ok(None);
    }

    let inherited = scope.reporter.inherited();
    let Some(exempt) = inherited.nearest(route.node_id, &NearestSetting::Csrf)? else {
        return derived_csrf(&cookies, identity, scope);
    };

    // The authoring schema writes `csrf` as `{ exempt: <reason> }`.
    let reason = access_identity_is_object(Some(exempt.value))
        .and_then(|written| access_identity_string(written, "exempt"));
    let Some(reason) = reason else {
        let node = inherited.nodes().get(exempt.node)?;

        return Err(InternalError::new(format!(
            "the csrf set at {} has no exempt reason",
            node.pointer
        )));
    };

    Ok(Some(Csrf::Exempt(ExemptCsrf {
        reason: Reason::new(reason.to_owned()),
        origin: exempt.origin.clone(),
    })))
}

fn derived_csrf(
    cookies: &[&CookieScheme],
    identity: KnownIdentityRef<'_>,
    scope: &mut AccessIdentityScope<'_, '_, '_, '_>,
) -> Result<Option<Csrf>, InternalError> {
    // A csrf header scheme left out of the catalogue for an error of its own is already
    // reported.
    let headers: Vec<Option<&str>> = cookies
        .iter()
        .map(|cookie| {
            let header = cookie
                .csrf
                .as_ref()
                .and_then(|csrf| scope.built.schemes.get(csrf));

            match header {
                Some(KnownScheme::Header(header)) => Some(header.name.as_str()),
                _ => None,
            }
        })
        .collect();
    let mut names: IndexSet<Option<&str>> = IndexSet::new();

    names.extend(headers);

    let Some(Some(name)) = names.first().copied() else {
        return Ok(None);
    };

    if names.contains(&None) {
        return Ok(None);
    }

    // The fault is the identity's, so it is located at its write list and reported once for all
    // its routes.
    let id = access_identity_id(identity);

    if names.len() > 1 {
        let listed: Vec<&str> = names.iter().flatten().copied().collect();

        scope.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::CsrfHeader,
            message: format!(
                "the write schemes of identity '{id}' are cookie schemes naming different csrf headers ({}), and a route checks one",
                listed.join(", ")
            ),
            fix: "Name one csrf header scheme on every cookie scheme an identity accepts on writes.".to_owned(),
            pointer: pointer_below("", &["identities", id.as_str(), "schemes", "write"]),
            related: Vec::new(),
        })?;

        return Ok(None);
    }

    let mut from = vec![access_identity_origin_of(identity).clone()];

    from.extend(cookies.iter().map(|cookie| cookie.origin.clone()));

    Ok(Some(Csrf::Derived(DerivedCsrf {
        header: name.to_owned(),
        derived_from: DerivedFrom {
            derivation: derivation_ids::CSRF_COOKIE_WRITE,
            from,
        },
    })))
}
