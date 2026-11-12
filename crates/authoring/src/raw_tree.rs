//! The loaded tree: what the load stage hands to the passes.

use camino::Utf8PathBuf;
use indexmap::IndexMap;
use seampact_ir::{Layer, Origin};
use seampact_json::{JsonObject, JsonValue};
use seampact_span::{Span, location_key};

use crate::ApiLayer;

/// A side table of positions (ADR 0004 section 11), keyed exactly `"<layer>#<pointer>"`.
///
/// Each span is a byte range of a file's normalised text; diagnostics and the source map turn it
/// into a line and a UTF-16 column through the file table.
pub type Locations = IndexMap<String, Span>;

/// A layer of an api read from a file.
#[derive(Debug, Clone, PartialEq)]
pub struct RawLayer {
    /// The layer, the one source of its kind.
    pub layer: ApiLayer,
    /// The file, relative to the workspace root.
    pub file: String,
    /// The document read from the file.
    pub tree: JsonObject,
}

/// The workspace entry document (ADR 0002 section 1), validated as kind `workspace`.
///
/// Not a layer of any api: its layer is always `workspace`, so no api-layer function accepts it.
#[derive(Debug, Clone, PartialEq)]
pub struct RawEntryLayer {
    /// The file, relative to the workspace root.
    pub file: String,
    /// The document read from the file.
    pub tree: JsonObject,
}

/// One api as loaded: its layers in application order (ADR 0002 section 2) and their merge.
#[derive(Debug, Clone, PartialEq)]
pub struct RawApi {
    /// The api's name.
    pub name: String,
    /// The layers in application order.
    pub layers: Vec<RawLayer>,
    /// The layers merged into one tree.
    pub merged: JsonObject,
    /// The origin of each leaf of `merged`, keyed by its JSON pointer.
    pub leaf_origins: IndexMap<String, Origin>,
    /// This api's side table: every pointer of every layer of the api, so a `leaf_origins`
    /// entry resolves as written. Finalize assembles the api's source map from it.
    pub locations: Locations,
    /// Per layer, the layers whose names it may resolve, itself included, sorted
    /// (ADR 0002 section 2).
    pub visibility: IndexMap<ApiLayer, Vec<ApiLayer>>,
}

/// What `workspace.yaml` says besides the apis, passed through unread.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RawWorkspaceConfig {
    /// The `editorSchemas` member.
    pub editor_schemas: Option<String>,
    /// The `imports` member, as written.
    pub imports: Option<JsonValue>,
}

/// The loaded workspace: every api, the load stage's side table, and the entry document.
#[derive(Debug, Clone, PartialEq)]
pub struct RawWorkspace {
    /// The workspace root directory.
    pub root: Utf8PathBuf,
    /// The apis, in load order.
    pub apis: Vec<RawApi>,
    /// The table for what no api's tree owns: the load stage's diagnostics and the entry
    /// document.
    ///
    /// A load diagnostic is located by a site pointer (`/~load/<file>/<line>/<col>`), a position
    /// in a file rather than a node of an api's tree, so a file reached by several apis is
    /// located once, here. Every pass after load locates its diagnostics through the table of
    /// its api, [`RawApi::locations`]. No key of this table meets a key of an api's table: a
    /// `/~load/` pointer is never produced by JSON Pointer escaping, and an api layer is never
    /// `workspace`.
    pub locations: Locations,
    /// The whole entry document when it is a `workspace.yaml`, absent for a single api file.
    /// Its pointers are located in [`RawWorkspace::locations`] under [`entry_location_key`].
    pub entry: Option<RawEntryLayer>,
    /// The loader's own read of `editorSchemas` and `imports`.
    pub config: Option<RawWorkspaceConfig>,
}

/// The key that locates `pointer` of the workspace entry document in
/// [`RawWorkspace::locations`], `workspace#<pointer>` (ADR 0006 section 4).
#[must_use]
pub fn entry_location_key(pointer: &str) -> String {
    location_key(&Layer::Workspace, pointer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_entry_key_is_the_workspace_layer_and_the_pointer() {
        assert_eq!(entry_location_key(""), "workspace#");
        assert_eq!(
            entry_location_key("/workspace/apis/0"),
            "workspace#/workspace/apis/0"
        );
        assert_eq!(entry_location_key("/a~1b/é"), "workspace#/a~1b/é");
    }

    #[test]
    fn the_loaded_tree_can_cross_threads() {
        const fn assert_send_sync<T: Send + Sync>() {}

        assert_send_sync::<RawWorkspace>();
        assert_send_sync::<RawApi>();
        assert_send_sync::<RawLayer>();
        assert_send_sync::<RawEntryLayer>();
    }
}
