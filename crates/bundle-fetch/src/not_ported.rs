//! The one way a stub answers: the error naming the TypeScript function it stands for.

use crate::BundleFetchError;

/// The error a stub of the TypeScript function `function` answers.
pub(crate) fn not_ported_yet(function: &'static str) -> BundleFetchError {
    BundleFetchError::NotPortedYet { function }
}
