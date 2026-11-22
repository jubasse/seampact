//! The sources a config names, resolved against the directory of the config file that writes them.

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_js::js_key_order;
use seampact_json::JsonValue;

use crate::json_access::{record, text};
use crate::node_path::resolved_path;

/// A bundle source as the config writes it, until the bundle crate declares its type.
pub type UnportedBundleSource = JsonValue;

/// A `path` source with its absolute workspace directory, or a bundle source as the config writes it.
#[derive(Debug, Clone, PartialEq)]
pub enum ResolvedSource {
    /// A contract workspace directory.
    Path {
        /// The absolute directory.
        directory: Utf8PathBuf,
    },
    /// A pinned bundle: the `package`, `release`, `git` or `maven` member as written.
    Bundle(UnportedBundleSource),
}

/// A `path` source resolved against `directory`, or a copy of the bundle source.
fn resolved_source(
    directory: &Utf8Path,
    source: &JsonValue,
) -> Result<ResolvedSource, InternalError> {
    let Some(object) = record(Some(source)) else {
        return Err(InternalError::new(
            "a source that is not a mapping passed the schema",
        ));
    };

    if let Some(path) = object.get("path") {
        let path = text(Some(path)).ok_or_else(|| {
            InternalError::new("a source path that is not text passed the schema")
        })?;

        return Ok(ResolvedSource::Path {
            directory: resolved_path(directory, path),
        });
    }

    Ok(ResolvedSource::Bundle(source.clone()))
}

/// Each source of `sources` resolved, in JavaScript key order.
pub(crate) fn resolved_sources(
    directory: &Utf8Path,
    sources: Option<&JsonValue>,
) -> Result<IndexMap<String, ResolvedSource>, InternalError> {
    js_key_order(record(sources).into_iter().flat_map(|object| object.iter()))
        .map(|(name, source)| Ok((name.clone(), resolved_source(directory, source)?)))
        .collect()
}
