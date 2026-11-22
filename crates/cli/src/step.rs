//! The outcome of a read that either gives a value or refuses with problems.

use seampact_cli_config::CliProblem;

/// A value, or the problems that refuse it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Step<Value> {
    /// The value was read.
    Done(Value),
    /// Why nothing was read.
    Refused(Vec<CliProblem>),
}
