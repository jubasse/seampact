//! How a half fails: a function not ported yet, or a bug.

use seampact_diagnostics::InternalError;

/// Why a half or a schema service call gave no answer.
///
/// `NotPortedYet` lives only while the pass halves are ported: the dispatch reads it as a half
/// not ported, and the oracle counts the pair as skipped, never as a match.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PassError {
    /// The run reached a function whose Rust body is not written yet.
    #[error("not ported yet: {function}")]
    NotPortedYet {
        /// The TypeScript name of the function.
        function: &'static str,
    },
    /// A bug, as everywhere else.
    #[error(transparent)]
    Internal(#[from] InternalError),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_internal_error_converts_and_displays_as_itself() {
        let internal = InternalError::new("a broken invariant");
        let pass_error = PassError::from(internal.clone());

        assert_eq!(pass_error.to_string(), internal.to_string());
        assert_eq!(
            PassError::NotPortedYet {
                function: "treeNodesRun"
            }
            .to_string(),
            "not ported yet: treeNodesRun"
        );
    }
}
