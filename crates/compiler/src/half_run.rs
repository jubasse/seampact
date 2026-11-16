//! The dispatch of one half: which crate runs it and how its output joins the draft.

use seampact_diagnostics::InternalError;
use seampact_pipeline::{
    AccessIdentityOutput, AccessRightsOutput, DeriveErrorsOutput, DeriveWireOutput, DraftIr,
    HalfContext, LaterHalf, PassError, TreeNodesOutput, TreeSchemaService,
};

/// Runs `tree.schemas` over `draft`, merges its catalogues into it and answers the service every
/// later half reads schemas through.
///
/// # Errors
///
/// An [`InternalError`] from the half or from the merge of its output.
pub fn run_tree_schemas(
    draft: &mut DraftIr,
    context: &mut HalfContext<'_>,
) -> Result<Box<dyn TreeSchemaService>, InternalError> {
    let (members, service) = seampact_pass_tree_schemas::run(draft, context)?.into_parts();

    members.merge_into(draft)?;

    Ok(service)
}

/// Runs the later half `half` over `draft`, reading schemas through `schemas`, and merges its
/// output into it.
///
/// # Errors
///
/// An [`InternalError`] from the half or from the merge of its output.
pub fn run_half(
    half: LaterHalf,
    draft: &mut DraftIr,
    context: &mut HalfContext<'_>,
    schemas: &dyn TreeSchemaService,
) -> Result<(), InternalError> {
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

/// Merges what a later half's entry answered into `draft` with `merge`.
///
/// # Errors
///
/// The [`InternalError`] the half answered, or one from `merge`.
pub(crate) fn merge_answer<Output>(
    answer: Result<Output, PassError>,
    draft: &mut DraftIr,
    merge: impl FnOnce(Output, &mut DraftIr) -> Result<(), InternalError>,
) -> Result<(), InternalError> {
    merge(answer?, draft)
}
