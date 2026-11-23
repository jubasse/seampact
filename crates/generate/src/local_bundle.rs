//! A bundle a build plugin already fetched, checked against the source's integrity.

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_bundle::{BundleVerifyResult, verify_bundle};
use seampact_cli_config::CliProblem;
use seampact_cli_config::located_problem;

use crate::GenerateError;

/// The directory of each bundle a plugin fetched, by source name.
pub type LocalBundles = IndexMap<String, Utf8PathBuf>;

/// What checking a local bundle answers.
#[derive(Debug, Clone, PartialEq)]
pub enum LocalBundleOutcome {
    /// The bundle's check, passed or failed.
    Verified(BundleVerifyResult),
    /// The directory cannot be checked at all.
    Refused(CliProblem),
}

/// Checks the bundle `directory` holds against the source's pinned `integrity`; a source without
/// one is refused, as nothing could be checked against it.
///
/// # Errors
///
/// [`GenerateError::Bundle`] when the directory cannot be read.
pub fn verify_local_bundle(
    name: &str,
    directory: &Utf8Path,
    integrity: Option<&str>,
) -> Result<LocalBundleOutcome, GenerateError> {
    let Some(integrity) = integrity else {
        return Ok(LocalBundleOutcome::Refused(located_problem(
            "cli.bundle-directory.unpinned",
            format!(
                "The source '{name}' is handed over as the local bundle {directory}, and it pins no integrity to check it against."
            ),
            "Pin the source's `integrity` in the app config.",
            format!("source '{name}'"),
        )));
    };

    Ok(LocalBundleOutcome::Verified(verify_bundle(
        directory,
        Some(integrity),
        None,
    )?))
}
