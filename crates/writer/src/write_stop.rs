//! What stops a write before it commits: refusals the user can fix, or a failure of the system.

use seampact_target::Refused;

use crate::WriterError;

/// Why a write did not happen; `?` carries either from a step that checks and does I/O.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum WriteStop {
    /// A check refused the write, naming each file and the fix.
    #[error(transparent)]
    Refused(#[from] Refused),
    /// A file or directory could not be read or written, or a bug.
    #[error(transparent)]
    Failed(#[from] WriterError),
}
