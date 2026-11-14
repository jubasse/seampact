//! The dispatch of one half: which crate runs it and how its output joins the draft.

use std::fmt;

use seampact_diagnostics::InternalError;
use seampact_pipeline::{
    AccessIdentityOutput, AccessRightsOutput, DeriveErrorsOutput, DeriveWireOutput, DraftIr,
    HalfContext, LaterHalf, PassError, TreeNodesOutput, TreeSchemaService,
};

/// What running one half after `tree.schemas` gave.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HalfRun {
    /// The half ran and its output is merged into the draft; its diagnostics went to the context.
    Merged,
    /// The half reached a function not ported yet: nothing is merged, and the diagnostics it
    /// reported before are the caller's to drop.
    NotPorted,
}

/// What running `tree.schemas` gave.
pub enum TreeSchemasRun {
    /// The half ran, its catalogues are merged into the draft, and every later half reads
    /// schemas through this service.
    Merged(Box<dyn TreeSchemaService>),
    /// The half reached a function not ported yet: nothing is merged.
    NotPorted,
}

impl fmt::Debug for TreeSchemasRun {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Merged(_) => formatter.write_str("Merged(..)"),
            Self::NotPorted => formatter.write_str("NotPorted"),
        }
    }
}

/// Runs `tree.schemas` over `draft` and merges its catalogues into it.
///
/// # Errors
///
/// An [`InternalError`] from the half or from the merge of its output.
pub fn run_tree_schemas(
    draft: &mut DraftIr,
    context: &mut HalfContext<'_>,
) -> Result<TreeSchemasRun, InternalError> {
    let Some(output) = ported(seampact_pass_tree_schemas::run(draft, context))? else {
        return Ok(TreeSchemasRun::NotPorted);
    };

    let (members, service) = output.into_parts();

    members.merge_into(draft)?;

    Ok(TreeSchemasRun::Merged(service))
}

/// Runs the later half `half` over `draft`, reading schemas through `schemas`, and merges its
/// output into it.
///
/// The [`HalfRun::NotPorted`] variant goes away with the last half.
///
/// # Errors
///
/// An [`InternalError`] from the half or from the merge of its output.
pub fn run_half(
    half: LaterHalf,
    draft: &mut DraftIr,
    context: &mut HalfContext<'_>,
    schemas: &dyn TreeSchemaService,
) -> Result<HalfRun, InternalError> {
    match half {
        LaterHalf::TreeNodes => merge_answer(
            seampact_pass_tree_nodes::run(draft, context, schemas),
            draft,
            TreeNodesOutput::merge_into,
        ),
        LaterHalf::AccessIdentity => merge_answer(
            seampact_pass_access_identity::run(draft, context, schemas),
            draft,
            AccessIdentityOutput::merge_into,
        ),
        LaterHalf::AccessRights => merge_answer(
            seampact_pass_access_rights::run(draft, context, schemas),
            draft,
            AccessRightsOutput::merge_into,
        ),
        LaterHalf::DeriveWire => merge_answer(
            seampact_pass_derive_wire::run(draft, context, schemas),
            draft,
            DeriveWireOutput::merge_into,
        ),
        LaterHalf::DeriveErrors => merge_answer(
            seampact_pass_derive_errors::run(draft, context, schemas),
            draft,
            DeriveErrorsOutput::merge_into,
        ),
    }
}

/// Merges what a later half's entry answered into `draft` with `merge`, or says it is not ported.
///
/// # Errors
///
/// The [`InternalError`] the half answered, or one from `merge`.
pub(crate) fn merge_answer<Output>(
    answer: Result<Output, PassError>,
    draft: &mut DraftIr,
    merge: impl FnOnce(Output, &mut DraftIr) -> Result<(), InternalError>,
) -> Result<HalfRun, InternalError> {
    let Some(output) = ported(answer)? else {
        return Ok(HalfRun::NotPorted);
    };

    merge(output, draft)?;

    Ok(HalfRun::Merged)
}

/// The output of an entry that ran, `None` for one that reached a function not ported yet.
///
/// # Errors
///
/// The [`InternalError`] the entry answered.
pub(crate) fn ported<Output>(
    answer: Result<Output, PassError>,
) -> Result<Option<Output>, InternalError> {
    match answer {
        Ok(output) => Ok(Some(output)),
        Err(PassError::NotPortedYet { .. }) => Ok(None),
        Err(PassError::Internal(internal)) => Err(internal),
    }
}
