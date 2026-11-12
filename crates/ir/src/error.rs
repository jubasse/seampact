//! The errors of reading and writing IR documents.

use seampact_json::JsonError;

/// An IR document or value that cannot be read or written.
#[derive(Debug, thiserror::Error)]
pub enum IrError {
    /// The JSON text does not decode into the IR types: a syntax error, a missing required
    /// member, a member of the wrong type, or an integer out of its range.
    #[error("the IR does not decode: {0}")]
    Decode(#[source] serde_json::Error),

    /// The IR types did not encode into JSON.
    #[error("the IR does not encode: {0}")]
    Encode(#[source] serde_json::Error),

    /// A value the JSON value model cannot hold.
    #[error(transparent)]
    Value(#[from] JsonError),

    /// An origin layer outside `api`, `shared`, `base`, `core`, `workspace` and `pack:<name>`.
    #[error(
        "expected a layer (api, shared, base, core, workspace or pack:<name>), found '{found}'"
    )]
    InvalidLayer {
        /// The text found.
        found: String,
    },
}
