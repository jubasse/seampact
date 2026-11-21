//! Contract bundles, ported from `packages/core/spec/src/bundle` and
//! `packages/core/compiler/src/bundle`: [`build_bundle`] builds a bundle from a workspace and
//! [`verify_bundle`] checks one on disk. Nothing here reaches the network.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the crate's last brief"
)]

mod build;
mod contents;
mod error;
mod failure;
mod manifest;
mod not_ported;
mod source;
mod verify;

use seampact_diagnostics::RuleId;

pub use build::{BundleBuildOptions, BundleBuildResult, BundleNamedVersionOverride, build_bundle};
pub use contents::BundleContents;
pub use error::BundleError;
pub use failure::{BundleFailure, BundleFailureCode};
pub use manifest::BundleManifest;
pub use source::BundleSource;
pub use verify::{BundleChannel, BundleVerifyResult, verify_bundle};

/// Every rule id the crate reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[];
