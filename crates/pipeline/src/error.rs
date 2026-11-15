//! How a half fails: a function not ported yet, or a bug.

use seampact_diagnostics::InternalError;
use seampact_ir::{IrError, NarrowUnionError};

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

/// A failed narrowing is a bug, as [`InternalError`]'s conversion says.
impl From<NarrowUnionError> for PassError {
    #[track_caller]
    fn from(error: NarrowUnionError) -> Self {
        Self::Internal(InternalError::from(error))
    }
}

/// An IR value that does not encode, or broken embedded IR schemas, is a bug of the compiler.
impl From<IrError> for PassError {
    #[track_caller]
    fn from(error: IrError) -> Self {
        Self::Internal(InternalError::new(error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use seampact_ir::{KnownSignatureVerify, SignatureVerify};

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

    #[test]
    fn a_failed_narrowing_is_an_internal_error_naming_the_union_and_tag() {
        let open: SignatureVerify = serde_json::from_str(r#"{"verify":"hardware"}"#).unwrap();
        let narrowed = KnownSignatureVerify::try_from(open).map_err(PassError::from);
        let Err(PassError::Internal(error)) = narrowed else {
            panic!("an internal error expected, got {narrowed:?}");
        };

        assert_eq!(
            error.what(),
            "the SignatureVerify variant `hardware` is not known to this compiler"
        );
    }
}
