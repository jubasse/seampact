//! The bundle source a config writes, read into the type the bundle fetch takes.

use seampact_bundle_source::{BundleSource, written_bundle_source};
use seampact_diagnostics::InternalError;
use seampact_json::JsonValue;

/// The bundle source of a config entry that is not a `path` source.
///
/// # Errors
///
/// [`InternalError`] when the entry names no source form the config schema allows.
pub fn bundle_source_of(entry: &JsonValue) -> Result<BundleSource, InternalError> {
    written_bundle_source(entry).ok_or_else(|| {
        InternalError::new(
            "a bundle source with no package, release, git or maven form passed the schema",
        )
    })
}
