//! What a diff reads besides the two contracts: today's date and the gate settings.

use std::collections::BTreeSet;

use seampact_ir::is_ir_calendar_date;
use seampact_json::{JsonValue, stringify_json};

use crate::DiffTableError;

/// Which broken sides fail `additive-only`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum DiffGateScope {
    /// `clients`: the default.
    Clients,
    /// `both`.
    Both,
}

impl DiffGateScope {
    /// The config text of the scope.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Clients => "clients",
            Self::Both => "both",
        }
    }

    /// The scope a config text names; none for any other text.
    #[must_use]
    pub fn from_text(text: &str) -> Option<Self> {
        [Self::Clients, Self::Both]
            .into_iter()
            .find(|scope| scope.as_str() == text)
    }
}

/// A breaking change reported but not gated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum DiffExemption {
    /// `experimental`: a change on an operation experimental in the baseline.
    Experimental,
    /// `sunsetPassed`: removing an operation whose sunset has passed.
    SunsetPassed,
}

impl DiffExemption {
    /// The config text of the exemption.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Experimental => "experimental",
            Self::SunsetPassed => "sunsetPassed",
        }
    }

    /// The exemption a config text names; none for any other text.
    #[must_use]
    pub fn from_text(text: &str) -> Option<Self> {
        [Self::Experimental, Self::SunsetPassed]
            .into_iter()
            .find(|exemption| exemption.as_str() == text)
    }
}

/// The options of a diff.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DiffOptions {
    /// Today as a calendar date (`YYYY-MM-DD`): the diff's only time input.
    pub today: String,
    /// Which broken sides fail `additive-only`; `clients` when absent.
    pub gate: Option<DiffGateScope>,
    /// The breaking changes reported but not gated; both exemptions when absent.
    pub exempt: Option<Vec<DiffExemption>>,
}

/// The options with their defaults filled in.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ResolvedDiffOptions {
    /// Today as a calendar date.
    pub today: String,
    /// Which broken sides fail `additive-only`.
    pub gate: DiffGateScope,
    /// The exemptions, sorted and without repeats.
    pub exempt: Vec<DiffExemption>,
}

/// The exemptions applied when `exempt` is absent: both.
const DEFAULT_DIFF_EXEMPTIONS: [DiffExemption; 2] =
    [DiffExemption::Experimental, DiffExemption::SunsetPassed];

/// The options with their defaults; a date that is not a calendar date is a caller error.
///
/// # Errors
///
/// [`DiffTableError::InvalidToday`] when `today` is not a `YYYY-MM-DD` calendar date. A gate or an
/// exemption outside its known set cannot be built, so the TypeScript's two other refusals have
/// no Rust case.
pub fn resolve_diff_options(options: &DiffOptions) -> Result<ResolvedDiffOptions, DiffTableError> {
    if !is_ir_calendar_date(&options.today) {
        return Err(DiffTableError::InvalidToday {
            today: stringify_json(&JsonValue::String(options.today.clone())),
        });
    }

    let gate = options.gate.unwrap_or(DiffGateScope::Clients);
    let exempt: BTreeSet<DiffExemption> = options
        .exempt
        .as_deref()
        .unwrap_or(&DEFAULT_DIFF_EXEMPTIONS)
        .iter()
        .copied()
        .collect();

    Ok(ResolvedDiffOptions {
        today: options.today.clone(),
        gate,
        exempt: exempt.into_iter().collect(),
    })
}
