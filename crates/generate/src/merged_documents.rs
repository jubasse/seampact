//! The merged documents of a root, each holding what its apps contribute.

use indexmap::IndexMap;
use seampact_cli_config::{LoadedWorkspace, Step};

use crate::not_ported::not_ported_yet;
use crate::{AppPlan, EmittedAppDocument, GenerateError};

/// Renders the merged documents of `workspace` from the plan of each app, by the app's name in
/// the root's `apps`.
///
/// # Errors
///
/// [`GenerateError::NotPortedYet`] until the function is ported.
pub fn emit_merged_documents(
    _workspace: &LoadedWorkspace,
    _plans: &IndexMap<&str, &AppPlan<'_>>,
) -> Result<Step<Vec<EmittedAppDocument>>, GenerateError> {
    Err(not_ported_yet("emitMergedDocuments"))
}
