//! A bundle a build plugin already fetched, checked against the source's integrity.

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_bundle::BundleVerifyResult;
use seampact_cli_config::CliProblem;

use crate::CliError;
use crate::not_ported::not_ported_yet;

/// The directory of each bundle a plugin fetched, by source name.
pub(crate) type LocalBundles = IndexMap<String, Utf8PathBuf>;

/// What checking a local bundle answers.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum LocalBundleOutcome {
    /// The bundle's check, passed or failed.
    Verified(BundleVerifyResult),
    /// The directory cannot be checked at all.
    Refused(CliProblem),
}

/// Checks the bundle `directory` holds against the source's pinned `integrity`.
pub(crate) fn verify_local_bundle(
    _name: &str,
    _directory: &Utf8Path,
    _integrity: Option<&str>,
) -> Result<LocalBundleOutcome, CliError> {
    Err(not_ported_yet("verifyLocalBundle"))
}
