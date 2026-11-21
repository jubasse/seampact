//! What a diff reads besides the two contracts: today's date and the gate settings.

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
