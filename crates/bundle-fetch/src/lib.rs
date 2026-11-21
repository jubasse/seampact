//! Fetching contract bundles, ported from `packages/core/compiler/src/bundle`: [`fetch_bundle`]
//! through the package, git and release channels with the cache, and
//! [`compile_workspace_with_imports`]. The one crate that reaches the network or runs `git`.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the crate's last brief"
)]

mod error;
mod fetch;
mod imports;
mod not_ported;

use seampact_diagnostics::RuleId;

pub use error::BundleFetchError;
pub use fetch::{
    BundleFetchOptions, BundleFetchResult, BundleSourceFailure, LocalSourcePolicy, ReleaseGet,
    fetch_bundle,
};
pub use imports::{
    WorkspaceImportFailure, WorkspaceImportsOptions, WorkspaceImportsResult,
    compile_workspace_with_imports,
};

/// Every rule id the crate reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[];
