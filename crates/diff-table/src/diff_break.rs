//! A side a change breaks.

/// A client generated from `before`, or a handler written for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DiffBreak {
    /// `clients`.
    Clients,
    /// `servers`.
    Servers,
}

impl DiffBreak {
    /// The side as the report writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Clients => "clients",
            Self::Servers => "servers",
        }
    }
}
