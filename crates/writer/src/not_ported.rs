//! The one way a stub answers: the error naming the TypeScript function it stands for.

use crate::WriterError;

/// The error a stub of the TypeScript function `function` answers.
pub(crate) const fn not_ported_yet(function: &'static str) -> WriterError {
    WriterError::NotPortedYet { function }
}
