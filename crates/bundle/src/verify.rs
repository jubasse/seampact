//! The check of a bundle on disk against its manifest and a pinned integrity.

use camino::Utf8Path;
use indexmap::IndexMap;
use seampact_ir::ContractIr;

use crate::not_ported::not_ported_yet;
use crate::{BundleError, BundleFailure, BundleManifest};

/// The channel a bundle was fetched through.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum BundleChannel {
    /// `package`.
    Package,
    /// `release`.
    Release,
    /// `git`.
    Git,
}

/// A verified bundle, or the failures that stop it.
#[derive(Debug, Clone, PartialEq)]
pub enum BundleVerifyResult {
    /// The bundle passed.
    Verified {
        /// The `manifest` member.
        manifest: BundleManifest,
        /// The `integrity` member.
        integrity: String,
        /// Each api's IR by api name.
        irs: IndexMap<String, ContractIr>,
    },
    /// Why the bundle is refused.
    Failed {
        /// The `failures` member.
        failures: Vec<BundleFailure>,
        /// The recomputed integrity, once the files passed: the value to pin.
        integrity: Option<String>,
    },
}

/// Verifies the bundle in `directory` against its manifest and `pinned_integrity`.
///
/// # Errors
///
/// [`BundleError::NotPortedYet`] until the function is ported.
pub fn verify_bundle(
    _directory: &Utf8Path,
    _pinned_integrity: Option<&str>,
    _channel: Option<BundleChannel>,
) -> Result<BundleVerifyResult, BundleError> {
    Err(not_ported_yet("verifyBundle"))
}
