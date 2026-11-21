//! A workspace compiled with the bundles its `imports` name.

use seampact_compiler::{PipelineOptions, PipelineResult};

use crate::not_ported::not_ported_yet;
use crate::{BundleFetchError, BundleFetchOptions};

/// Why a workspace import cannot be fetched.
///
/// Declared by the brief that ports `imports.ts`; uninhabited until then.
#[derive(Debug, Clone, PartialEq)]
pub enum WorkspaceImportFailure {}

/// What a workspace with imports is compiled from.
pub struct WorkspaceImportsOptions<'run> {
    /// The compile options; their `imports` are replaced by the fetched bundles.
    pub pipeline: PipelineOptions<'run>,
    /// How the bundles are fetched: `base_directory` is the workspace root.
    pub fetch: BundleFetchOptions<'run>,
}

impl std::fmt::Debug for WorkspaceImportsOptions<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("WorkspaceImportsOptions")
            .field("fetch", &self.fetch)
            .finish_non_exhaustive()
    }
}

/// The compilation, or the import failures that stop it.
#[derive(Debug, Clone)]
pub enum WorkspaceImportsResult {
    /// The `compiled` member.
    Compiled(Box<PipelineResult>),
    /// The `failures` member.
    Failed(Vec<WorkspaceImportFailure>),
}

/// Fetches the workspace's imports, then compiles it with them.
///
/// # Errors
///
/// [`BundleFetchError::NotPortedYet`] until the function is ported.
pub fn compile_workspace_with_imports(
    _options: &WorkspaceImportsOptions<'_>,
) -> Result<WorkspaceImportsResult, BundleFetchError> {
    Err(not_ported_yet("compileWorkspaceWithImports"))
}
