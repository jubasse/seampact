//! The parameters of an operation.

use seampact_ir::{DerivationId, Param};

/// The derivation of the credential parameters of the accepted schemes.
const AUTHENTICATE_DERIVATION: DerivationId = DerivationId::from_static("identity.authenticate");

/// The derivation of the CSRF header parameter.
const CSRF_COOKIE_WRITE_DERIVATION: DerivationId = DerivationId::from_static("csrf.cookieWrite");

/// The derivations that write a credential parameter, which the security schemes carry instead.
const SCHEME_DERIVATIONS: [DerivationId; 2] =
    [AUTHENTICATE_DERIVATION, CSRF_COOKIE_WRITE_DERIVATION];

/// Whether a parameter is a credential a security scheme writes.
fn written_by_security(param: &Param) -> bool {
    param
        .derived_from
        .as_ref()
        .is_some_and(|derived| SCHEME_DERIVATIONS.contains(&derived.derivation))
}
