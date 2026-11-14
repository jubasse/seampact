//! The one way this crate says a function is not ported yet.

use seampact_pipeline::PassError;

/// The error a stub returns: `function` is the TypeScript name of the function it stands for.
pub(crate) fn not_ported_yet(function: &'static str) -> PassError {
    PassError::NotPortedYet { function }
}
