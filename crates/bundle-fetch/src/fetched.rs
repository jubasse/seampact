//! What a channel fetched: a directory to verify, or why nothing was fetched.

use camino::Utf8PathBuf;

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
        removal: RemovedOnDrop,
    },
    /// Why nothing was fetched.
    Failed(BundleSourceFailure),
}
