//! The core rules of the `seampact` plugin, in the order of the grammar table.

use seampact_diagnostics::RuleId;

use crate::lint_finding::{LintFinding, LintRuleContext};
use crate::rules::{
    cookie_without_csrf, credential_name, not_found_role, redundant_maturity, subtree_exception,
    unused_declaration,
};

/// The name of the plugin that owns the core rules; the prefix of their ids.
pub(crate) const CORE_PLUGIN_NAME: &str = "seampact";

/// A rule of the core plugin.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CoreRule {
    /// A safety exception written on a node that is neither a route nor a surface root.
    SubtreeException,
    /// A cookie scheme without `csrf`.
    CookieWithoutCsrf,
    /// A stated maturity equal to the derived one.
    RedundantMaturity,
    /// A property named like a credential and not `sensitive`.
    CredentialName,
    /// A declaration no operation, identity or convention reaches.
    UnusedDeclaration,
    /// A declared 404 code beside the derived notFound code on a route.
    NotFoundRole,
}

impl CoreRule {
    /// Every core rule, in the order the rules run.
    pub const ALL: &'static [Self] = &[
        Self::SubtreeException,
        Self::CookieWithoutCsrf,
        Self::RedundantMaturity,
        Self::CredentialName,
        Self::UnusedDeclaration,
        Self::NotFoundRole,
    ];

    /// The full id text, `seampact/<name>`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SubtreeException => "seampact/subtree-exception",
            Self::CookieWithoutCsrf => "seampact/cookie-without-csrf",
            Self::RedundantMaturity => "seampact/redundant-maturity",
            Self::CredentialName => "seampact/credential-name",
            Self::UnusedDeclaration => "seampact/unused-declaration",
            Self::NotFoundRole => "seampact/not-found-role",
        }
    }

    /// The rule as a diagnostic's rule id.
    #[must_use]
    pub const fn rule_id(self) -> RuleId {
        RuleId::from_static(self.as_str())
    }

    /// The findings of the rule over one api.
    pub(crate) fn check(self, context: &LintRuleContext<'_>) -> Vec<LintFinding> {
        match self {
            Self::SubtreeException => subtree_exception::check(context),
            Self::CookieWithoutCsrf => cookie_without_csrf::check(context),
            Self::RedundantMaturity => redundant_maturity::check(context),
            Self::CredentialName => credential_name::check(context),
            Self::UnusedDeclaration => unused_declaration::check(context),
            Self::NotFoundRole => not_found_role::check(context),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_id_is_the_plugin_name_and_a_kebab_case_rule_name() {
        for rule in CoreRule::ALL {
            let name = rule
                .as_str()
                .strip_prefix(CORE_PLUGIN_NAME)
                .and_then(|rest| rest.strip_prefix('/'));

            assert!(
                name.is_some_and(|name| !name.is_empty()
                    && name.chars().all(|c| c.is_ascii_lowercase() || c == '-')),
                "rule {rule:?}"
            );
        }
    }
}
