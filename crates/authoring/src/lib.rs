//! The authoring side of the Rust port: the grammar data and the tree the loader hands over.
//!
//! [`RawWorkspace`] is what the load stage hands to the passes: each [`RawApi`] with its
//! [`RawLayer`]s, their merge, the origin of each leaf and the side table of [`Locations`]. The
//! trees are [`JsonObject`](seampact_json::JsonObject)s read through [`JsonObjectExt`], where a
//! member of an unexpected type reads as absent. The grammar data are the embedded authoring
//! schemas ([`AUTHORING_SCHEMA_FILES`]), the titles they write ([`MARKERS`], [`EDITOR_TITLES`],
//! [`DATA`]), the [`RESERVED_NAMES`] and the decision on each JSON Schema keyword
//! ([`SCHEMA_KEYWORDS`]).

mod keywords;
mod layer;
mod markers;
mod raw_tree;
mod readers;
mod schema_files;

pub use keywords::{
    RefusedForm, SCHEMA_KEYWORDS, SchemaKeyword, SchemaKeywordDecision, refused_schema_keywords,
    schema_keyword,
};
pub use layer::{ApiLayer, FileLayer, LayerKind, LayerSchemaKind};
pub use markers::{DATA, EDITOR_TITLES, EXTENSION_KEY, MARKERS, Marker, RESERVED_NAMES};
pub use raw_tree::{
    Locations, RawApi, RawEntryLayer, RawLayer, RawWorkspace, RawWorkspaceConfig,
    entry_location_key,
};
pub use readers::JsonObjectExt;
pub use schema_files::{AUTHORING_SCHEMA_FILES, AuthoringSchemaFile};
