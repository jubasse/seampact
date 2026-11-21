//! The rules of the diagnostics about the `lint` settings themselves.

use seampact_diagnostics::RuleId;

/// A rule that reports a `lint.rules` or `lint.allow` entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LintSettingRule {
    /// An entry names a rule its plugin does not have.
    UnknownRule,
    /// An entry names a rule no loaded plugin owns.
    UnclaimedRule,
}

impl LintSettingRule {
    /// Every rule of the settings.
    pub const ALL: &'static [Self] = &[Self::UnknownRule, Self::UnclaimedRule];

    /// The full id text.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::UnknownRule => "seampact/lint/unknown-rule",
            Self::UnclaimedRule => "seampact/lint/unclaimed-rule",
        }
    }

    /// The rule as a diagnostic's rule id.
    #[must_use]
    pub const fn rule_id(self) -> RuleId {
        RuleId::from_static(self.as_str())
    }
}
