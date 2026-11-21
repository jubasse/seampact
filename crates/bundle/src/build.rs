//! A bundle built from a workspace.

use seampact_compiler::PipelineResult;
use seampact_load::LoadReader;

use crate::not_ported::not_ported_yet;
use crate::{BundleContents, BundleError, BundleFailure};

/// The contract's name and version, each over the workspace root `package.json`'s.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BundleNamedVersionOverride {
    /// The `name` member.
    pub name: Option<String>,
    /// The `version` member.
    pub version: Option<String>,
}

/// What a bundle is built from.
pub struct BundleBuildOptions<'run> {
    /// The reader the workspace is loaded through.
    pub reader: &'run dyn LoadReader,
    /// Root-relative path of the entry file, as `compile_workspace` takes it.
    pub entry: &'run str,
    /// The contract's name and version, over the workspace root `package.json`.
    pub contract: Option<BundleNamedVersionOverride>,
}

impl std::fmt::Debug for BundleBuildOptions<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("BundleBuildOptions")
            .field("entry", &self.entry)
            .field("contract", &self.contract)
            .finish_non_exhaustive()
    }
}

/// The built bundle, or the failures that stop it.
#[derive(Debug, Clone)]
pub enum BundleBuildResult {
    /// The bundle's files and the compilation, whose diagnostics hold the warnings.
    Built {
        /// The `contents` member.
        contents: BundleContents,
        /// The `compiled` member.
        compiled: Box<PipelineResult>,
    },
    /// Why no bundle is built.
    Failed {
        /// The `failures` member.
        failures: Vec<BundleFailure>,
        /// The compilation, when it failed: its diagnostics are the failure's detail.
        compiled: Option<Box<PipelineResult>>,
    },
}

/// Builds the bundle of a workspace.
///
/// # Errors
///
/// [`BundleError::NotPortedYet`] until the function is ported.
pub fn build_bundle(_options: &BundleBuildOptions<'_>) -> Result<BundleBuildResult, BundleError> {
    Err(not_ported_yet("buildBundle"))
}
