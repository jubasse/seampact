//! The levels of the `checks` keys: how `check` reports a drift and the matrix an untested major.

use serde::Deserialize;

/// `error` fails `check` (the default), `warning` reports and passes, `disabled` skips the check.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckLevel {
    /// The check is skipped.
    Disabled,
    /// A finding is reported and the run passes.
    Warning,
    /// A finding fails the run.
    #[default]
    Error,
}

impl CheckLevel {
    /// The level as the config writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Warning => "warning",
            Self::Error => "error",
        }
    }
}

/// The level of `checks.matrix`: `allowUntested` silences one major, so it has no `disabled`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MatrixCheckLevel {
    /// An untested major is reported and the run passes (the default).
    #[default]
    Warning,
    /// An untested major fails the run.
    Error,
}

impl MatrixCheckLevel {
    /// The level as the config writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Warning => "warning",
            Self::Error => "error",
        }
    }
}
