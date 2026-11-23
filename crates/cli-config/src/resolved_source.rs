//! The sources a config names, resolved against the directory of the config file that writes them.

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_bundle_source::BundleSource;
use seampact_diagnostics::InternalError;
use seampact_js::js_key_order;
use seampact_json::{JsonValue, object_of, text_of};

use crate::bundle_source::bundle_source_of;
use crate::node_path::resolved_path;

/// A `path` source with its absolute workspace directory, or a bundle source read from the config.
#[derive(Debug, Clone, PartialEq)]
pub enum ResolvedSource {
    /// A contract workspace directory.
    Path {
        /// The absolute directory.
        directory: Utf8PathBuf,
    },
    /// A pinned bundle: the `package`, `release`, `git` or `maven` member of the entry.
    Bundle(BundleSource),
}

/// A `path` source resolved against `directory`, or the bundle source the entry writes.
fn resolved_source(
    directory: &Utf8Path,
    source: &JsonValue,
) -> Result<ResolvedSource, InternalError> {
    let Some(object) = object_of(Some(source)) else {
        return Err(InternalError::new(
            "a source that is not a mapping passed the schema",
        ));
    };

    if let Some(path) = object.get("path") {
        let path = text_of(Some(path)).ok_or_else(|| {
            InternalError::new("a source path that is not text passed the schema")
        })?;

        return Ok(ResolvedSource::Path {
            directory: resolved_path(directory, path),
        });
    }

    Ok(ResolvedSource::Bundle(bundle_source_of(source)?))
}

/// Each source of `sources` resolved, in JavaScript key order.
pub(crate) fn resolved_sources(
    directory: &Utf8Path,
    sources: Option<&JsonValue>,
) -> Result<IndexMap<String, ResolvedSource>, InternalError> {
    js_key_order(
        object_of(sources)
            .into_iter()
            .flat_map(|object| object.iter()),
    )
    .map(|(name, source)| Ok((name.clone(), resolved_source(directory, source)?)))
    .collect()
}
