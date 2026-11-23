//! The problems a pure check refuses with: the error side of a `Result` that carries a value.

use crate::CliProblem;

/// The problems that refuse a step; none when the step already printed its diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[must_use]
pub struct Problems(Vec<CliProblem>);

impl Problems {
    /// A refusal that holds `problems`, even none: a source whose diagnostics were printed fails
    /// the run without a problem to list.
    pub fn new(problems: Vec<CliProblem>) -> Self {
        Self(problems)
    }

    /// Passes when `problems` is empty, else refuses with all of them.
    ///
    /// # Errors
    ///
    /// The problems themselves, when there is one.
    pub fn refuse_any(problems: Vec<CliProblem>) -> Result<(), Self> {
        if problems.is_empty() {
            return Ok(());
        }

        Err(Self(problems))
    }

    /// The problems, in the order they were found.
    #[must_use]
    pub fn as_slice(&self) -> &[CliProblem] {
        &self.0
    }

    /// The problems, in the order they were found.
    #[must_use]
    pub fn into_vec(self) -> Vec<CliProblem> {
        self.0
    }
}

impl From<CliProblem> for Problems {
    fn from(problem: CliProblem) -> Self {
        Self(vec![problem])
    }
}

impl IntoIterator for Problems {
    type Item = CliProblem;
    type IntoIter = std::vec::IntoIter<CliProblem>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.into_iter()
    }
}
