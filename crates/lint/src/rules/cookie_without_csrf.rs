//! A cookie scheme without `csrf` (grammar section 9).

use seampact_ir::KnownSchemeRef;

use crate::lint_finding::{LintFinding, LintRuleContext};
use crate::origins::lint_owns_origin;

/// The findings of the rule `seampact/cookie-without-csrf`.
pub(crate) fn check(context: &LintRuleContext<'_>) -> Vec<LintFinding> {
    let mut findings = Vec::new();

    for scheme in context.ir.schemes.values() {
        let Ok(KnownSchemeRef::Cookie(cookie)) = KnownSchemeRef::try_from(scheme) else {
            continue;
        };

        if cookie.csrf.is_some() || !lint_owns_origin(&cookie.origin) {
            continue;
        }

        findings.push(LintFinding {
            message: format!(
                "The cookie scheme '{}' has no csrf, so no CSRF check is derived for the routes it reaches.",
                cookie.id
            ),
            fix: format!(
                "Add csrf: <header scheme> to '{}', or allow seampact/cookie-without-csrf on it with a reason.",
                cookie.id
            ),
            origin: cookie.origin.clone(),
            allow_at: vec![cookie.origin.clone()],
        });
    }

    findings
}
