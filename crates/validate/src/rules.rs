//! The rule ids of the validate stage (ADR 0006 section 4): stable, kebab case.

use seampact_diagnostics::RuleId;

/// A rule of the validate stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ValidateRule {
    /// A key the schema does not list.
    UnknownKeyword,
    /// A JSON Schema keyword refused by ADR 0003.
    RefusedKeyword,
    /// A safety exception without its reason.
    ReasonRequired,
    /// A required key or a key of a choice is missing.
    MissingKeyword,
    /// Keys that exclude each other, or too many keys.
    ConflictingKeywords,
    /// A name, key or prefix that is not valid.
    InvalidName,
    /// A value of the wrong type.
    WrongType,
    /// A value outside what the schema allows.
    InvalidValue,
}

impl ValidateRule {
    /// The id text.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::UnknownKeyword => "seampact/validate/unknown-keyword",
            Self::RefusedKeyword => "seampact/validate/refused-keyword",
            Self::ReasonRequired => "seampact/validate/reason-required",
            Self::MissingKeyword => "seampact/validate/missing-keyword",
            Self::ConflictingKeywords => "seampact/validate/conflicting-keywords",
            Self::InvalidName => "seampact/validate/invalid-name",
            Self::WrongType => "seampact/validate/wrong-type",
            Self::InvalidValue => "seampact/validate/invalid-value",
        }
    }

    /// The rule as a diagnostic's rule id.
    #[must_use]
    pub const fn rule_id(self) -> RuleId {
        RuleId::from_static(self.as_str())
    }
}

/// Every rule id the stage reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[
    ValidateRule::UnknownKeyword.rule_id(),
    ValidateRule::RefusedKeyword.rule_id(),
    ValidateRule::ReasonRequired.rule_id(),
    ValidateRule::MissingKeyword.rule_id(),
    ValidateRule::ConflictingKeywords.rule_id(),
    ValidateRule::InvalidName.rule_id(),
    ValidateRule::WrongType.rule_id(),
    ValidateRule::InvalidValue.rule_id(),
];
