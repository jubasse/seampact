//! The one way a stub answers: the error naming the TypeScript function it stands for.

use crate::GenerateError;

/// The error a stub of the TypeScript function `function` answers.
pub(crate) const fn not_ported_yet(function: &'static str) -> GenerateError {
    GenerateError::NotPortedYet { function }
}
