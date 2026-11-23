//! The merged documents of a root, each holding what its apps contribute.

use indexmap::IndexMap;
use seampact_cli_config::LoadedWorkspace;

use crate::not_ported::not_ported_yet;
use crate::stop::Stop;
use crate::{AppPlan, EmittedAppDocument};

/// Renders the merged documents of `workspace` from the plan of each app, by the app's name in
/// the root's `apps`.
///
/// # Errors
///
/// [`Stop::Failed`] with [`GenerateError::NotPortedYet`](crate::GenerateError::NotPortedYet)
/// until the function is ported.
pub fn emit_merged_documents(
    _workspace: &LoadedWorkspace,
    _plans: &IndexMap<&str, &AppPlan<'_>>,
) -> Result<Vec<EmittedAppDocument>, Stop> {
    Err(not_ported_yet("emitMergedDocuments").into())
}
