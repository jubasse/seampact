//! The dispatch of one half: which crate runs it and how its output joins the draft.

use seampact_diagnostics::InternalError;
use seampact_pipeline::{DraftIr, Half, HalfContext};

/// What running one half gave.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HalfRun {
    /// The half ran and its output is merged into the draft; its diagnostics went to the context.
    Merged,
    /// The half is not ported.
    NotPorted,
}

/// Runs `half` over `draft` and merges its output into it.
///
/// Each pass lane replaces its arm; the arm and the [`HalfRun::NotPorted`] variant go away with
/// the last half.
///
/// # Errors
///
/// An [`InternalError`] from the half or from the merge of its output.
pub fn run_half(
    half: Half,
    _draft: &mut DraftIr,
    _context: &mut HalfContext<'_>,
) -> Result<HalfRun, InternalError> {
    match half {
        Half::TreeSchemas
        | Half::TreeNodes
        | Half::AccessIdentity
        | Half::AccessRights
        | Half::DeriveWire
        | Half::DeriveErrors => Ok(HalfRun::NotPorted),
    }
}
