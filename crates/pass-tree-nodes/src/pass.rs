//! The run of the half: its scope, which reads the draft and owns the output, and its entry.

use std::collections::HashSet;

use seampact_pipeline::{DraftIr, HalfContext, PassError, TreeNodesOutput, TreeSchemaService};

use crate::not_ported::not_ported_yet;

/// What every function of the half reads and writes during one run.
///
/// `draft` is read only; every write goes to `output`, which the dispatch merges into the draft.
pub(crate) struct TreeNodesScope<'draft, 'half, 'run> {
    pub(crate) draft: &'draft DraftIr,
    pub(crate) context: &'half mut HalfContext<'run>,
    pub(crate) schemas: &'half dyn TreeSchemaService,
    pub(crate) output: TreeNodesOutput,
    /// The keys of the diagnostics `treeNodesReportOnce` already reported; looked up, never iterated.
    pub(crate) reported_once: HashSet<String>,
}

/// Runs `tree.nodes` over the draft, reading schemas through the service `tree.schemas` built.
///
/// # Errors
///
/// [`PassError::NotPortedYet`] when the run reaches a function not ported yet, else
/// [`PassError::Internal`] for a bug.
pub fn run(
    _draft: &DraftIr,
    _context: &mut HalfContext<'_>,
    _schemas: &dyn TreeSchemaService,
) -> Result<TreeNodesOutput, PassError> {
    Err(not_ported_yet("treeNodesPass.run"))
}
