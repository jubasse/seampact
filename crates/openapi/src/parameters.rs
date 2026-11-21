//! The parameters of an operation.

use seampact_ir::Param;

/// The derivations that write a credential parameter, which the security schemes carry instead.
const SCHEME_DERIVATIONS: [&str; 2] = ["identity.authenticate", "csrf.cookieWrite"];

/// Whether a parameter is a credential a security scheme writes.
fn written_by_security(param: &Param) -> bool {
    param
        .derived_from
        .as_ref()
        .is_some_and(|derived| SCHEME_DERIVATIONS.contains(&derived.derivation.as_str()))
}
