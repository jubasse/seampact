//! How a change is classified.

/// What a change means for the contract's consumers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DiffClassification {
    /// `additive`.
    Additive,
    /// `breaking`.
    Breaking,
    /// `informative`: reported and never gated.
    Informative,
}

impl DiffClassification {
    /// The classification as the report writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Additive => "additive",
            Self::Breaking => "breaking",
            Self::Informative => "informative",
        }
    }
}
