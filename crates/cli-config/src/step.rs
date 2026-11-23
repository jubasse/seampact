//! The outcome of a step of a command that either gives a value or refuses with problems.

use crate::CliProblem;

/// A value, or the problems that refuse it.
#[derive(Debug, Clone, PartialEq)]
pub enum Step<Value> {
    /// The step gave its value.
    Done(Value),
    /// Why the step gave nothing.
    Refused(Vec<CliProblem>),
}
