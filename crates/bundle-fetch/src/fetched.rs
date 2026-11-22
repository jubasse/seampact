//! What a channel fetched: a directory to verify, or why nothing was fetched.

use camino::Utf8PathBuf;
use seampact_bundle::ExtractedBundle;

use crate::BundleSourceFailure;
use crate::removed_on_drop::RemovedOnDrop;

/// What a channel fetched.
#[derive(Debug)]
pub(crate) enum Fetched {
    /// The bundle directory, removed with what the fetch made when the value drops.
    Directory {
        /// The bundle directory.
        directory: Utf8PathBuf,
        /// Removes what was fetched when it drops.
        removal: FetchedRemoval,
    },
    /// Why nothing was fetched.
    Failed(BundleSourceFailure),
}

/// What removes a fetched directory when it drops.
#[expect(
    dead_code,
    reason = "each variant is held only for the removal its Drop does"
)]
#[derive(Debug)]
pub(crate) enum FetchedRemoval {
    /// A directory the fetch made itself.
    Made(RemovedOnDrop),
    /// A private directory the archive reader extracted into.
    Extracted(ExtractedBundle),
}
