//! What a write does with a generated file edited by hand since the last write.

/// `--force` overwrites a hand-edited file; without it the write is refused.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum HandEditPolicy {
    /// The write is refused, naming the edited files.
    #[default]
    Refuse,
    /// The file is overwritten.
    Overwrite,
}

impl HandEditPolicy {
    /// The policy as the TypeScript's `onHandEdit` writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Refuse => "refuse",
            Self::Overwrite => "overwrite",
        }
    }
}
