//! The contract lint, ported from `packages/core/lint/src` without the plugin loader (ADR 0031):
//! [`run_lint`] runs the core rules over one compiled api.

mod core_rule;
mod error;
mod lint_finding;
mod lint_setting_rule;
mod origins;
mod resolve;
mod rules;
mod run_lint;

use seampact_diagnostics::RuleId;

pub use core_rule::CoreRule;
pub use error::LintError;
pub use lint_setting_rule::LintSettingRule;
pub use run_lint::{RunLintInput, run_lint};

/// Every rule id the crate reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[
    CoreRule::SubtreeException.rule_id(),
    CoreRule::CookieWithoutCsrf.rule_id(),
    CoreRule::RedundantMaturity.rule_id(),
    CoreRule::CredentialName.rule_id(),
    CoreRule::UnusedDeclaration.rule_id(),
    CoreRule::NotFoundRole.rule_id(),
    LintSettingRule::UnknownRule.rule_id(),
    LintSettingRule::UnclaimedRule.rule_id(),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_rule_ids_list_every_rule_of_both_enums() {
        let expected: Vec<RuleId> = CoreRule::ALL
            .iter()
            .map(|rule| rule.rule_id())
            .chain(LintSettingRule::ALL.iter().map(|rule| rule.rule_id()))
            .collect();

        assert_eq!(RULE_IDS, expected.as_slice());
    }
}
