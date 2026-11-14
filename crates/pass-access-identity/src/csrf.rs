//! The CSRF decision of an operation (ADR 0002 section 9, ADR 0006 section 5
//! `csrf.cookieWrite`): derived on a non-safe operation whose write schemes include a cookie
//! scheme declaring `csrf` (opt-in, A34), and exempt there where the nearest `csrf: { exempt }`
//! says so. Elsewhere it is absent, an inherited exemption included, since there is no check to
//! exempt: a safe operation (a batch read included), a public route, a route without such a
//! cookie, and a signed identity's route, which never derives it (ADR 0013).

use seampact_diagnostics::InternalError;
use seampact_ir::{Access, CookieScheme, Csrf, ExemptCsrf, Reason, Scheme};
use seampact_pipeline::{NearestSetting, PassError};

use crate::access::{
    AccessIdentityResolved, AccessIdentityRoute, AccessIdentityScope,
    access_identity_access_schemes,
};
use crate::known::KnownIdentity;
use crate::not_ported::not_ported_yet;
use crate::read::{access_identity_is_object, access_identity_string};

/// The derivation of a derived `csrf`.
pub(crate) const CSRF_DERIVATION: &str = "csrf.cookieWrite";

/// The `csrf` member of an operation; `None` when it has none, or when refused with the error
/// reported.
pub(crate) fn access_identity_csrf(
    route: &AccessIdentityRoute<'_, '_>,
    resolved: &AccessIdentityResolved<'_>,
    scope: &mut AccessIdentityScope<'_, '_, '_>,
) -> Result<Option<Csrf>, PassError> {
    if route.safe || matches!(resolved.access, Access::Public(_)) {
        return Ok(None);
    }

    let Some(identity) = resolved.identity else {
        return Ok(None);
    };

    if matches!(identity, KnownIdentity::Signed(_)) {
        return Ok(None);
    }

    let built = scope.built;
    let schemes = access_identity_access_schemes(&resolved.access)?.unwrap_or(&[]);
    let cookies: Vec<&CookieScheme> = schemes
        .iter()
        .filter_map(|id| match built.schemes.get(id) {
            Some(Scheme::Cookie(cookie)) if cookie.csrf.is_some() => Some(cookie),
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
        ))
        .into());
    };

    Ok(Some(Csrf::Exempt(ExemptCsrf {
        reason: Reason::new(reason.to_owned()),
        origin: exempt.origin.clone(),
    })))
}

fn derived_csrf(
    _cookies: &[&CookieScheme],
    _identity: KnownIdentity<'_>,
    _scope: &mut AccessIdentityScope<'_, '_, '_>,
) -> Result<Option<Csrf>, PassError> {
    Err(not_ported_yet("derivedCsrf"))
}
