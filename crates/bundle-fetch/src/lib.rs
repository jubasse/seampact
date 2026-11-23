//! Fetching contract bundles, ported from `packages/core/compiler/src/bundle`: [`fetch_bundle`]
//! through the package, git and release channels with the cache, and
//! [`compile_workspace_with_imports`]. The one crate that reaches the network or runs `git`.

mod cache;
mod environment;
mod error;
mod fetch;
mod fetch_failure;
mod fetch_git;
mod fetch_package;
mod fetch_release;
mod fetched;
mod git_run;
mod git_source;
mod git_tree;
mod imports;
mod local_sources;
mod printable_url;
mod release_get;
mod removed_on_drop;

use seampact_diagnostics::RuleId;

pub use cache::CACHE_DIRECTORY_VARIABLE;
pub use environment::Environment;
pub use error::BundleFetchError;
pub use fetch::{BundleFetchOptions, BundleFetchResult, fetch_bundle};
pub use fetch_failure::{BundleSourceFailure, BundleSourceFailureCode};
pub use imports::{
    WorkspaceImportFailure, WorkspaceImportsOptions, WorkspaceImportsResult,
    compile_workspace_with_imports,
};
pub use local_sources::{
    ALLOW_LOCAL_VARIABLE, LocalSourcePolicy, local_source_policy, local_source_refusal_reason,
};
pub use release_get::{ReleaseGet, ReleaseGetError, ReleaseResponse, UreqReleaseGet};
pub use url::Url;

/// Every rule id the crate reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[];
