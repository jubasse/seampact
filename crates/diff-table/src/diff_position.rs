//! Where a change is reached from.

/// The request, a response, or neither (an operation or api member).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DiffPosition {
    /// `input`: the request.
    Input,
    /// `output`: a response.
    Output,
    /// `none`: an operation or api member.
    None,
}

impl DiffPosition {
    /// The position as the report writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Input => "input",
            Self::Output => "output",
            Self::None => "none",
        }
    }
}
