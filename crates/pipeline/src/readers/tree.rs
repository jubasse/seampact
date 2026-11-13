//! The tree-node model of the merged raw tree (ADR 0002 section 6), which `inherited` walks
//! (ADR 0006 section 2).

use std::sync::LazyLock;

use seampact_authoring::{JsonObjectExt, RawApi};
use seampact_diagnostics::InternalError;
use seampact_ir::{Layer, Origin};
use seampact_json::{JsonObject, JsonValue};

use super::pointer::{pipeline_origin, pointer_below};

/// The kind of a tree node.
///
/// `Scope` is the `collection` or `member` scope of a collection, which exists whether or not it
/// is written; `Op` is one entry of an `ops` shorthand, whose parent is its scope (`list`,
/// `create`, `batch` under `collection`, `get`, `update`, `delete` under `member`) or the single
/// it is written on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TreeNodeKind {
    /// A surface.
    Surface,
    /// A single.
    Single,
    /// A collection.
    Collection,
    /// The `collection` or `member` scope of a collection.
    Scope,
    /// A route.
    Route,
    /// A relay route.
    Relay,
    /// One entry of an `ops` shorthand.
    Op,
}

impl TreeNodeKind {
    /// The kind as the tree-node tests write it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Surface => "surface",
            Self::Single => "single",
            Self::Collection => "collection",
            Self::Scope => "scope",
            Self::Route => "route",
            Self::Relay => "relay",
            Self::Op => "op",
        }
    }
}

/// The place of a node in [`TreeNodes`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TreeNodeId(usize);

/// One node of the api's surfaces.
#[derive(Debug, Clone, PartialEq)]
pub struct TreeNode<'raw> {
    /// The kind of the node.
    pub kind: TreeNodeKind,
    /// The surface, child, scope (`collection` or `member`) or op name.
    pub name: String,
    /// The JSON Pointer of the node in the merged raw tree.
    ///
    /// A scope not written points where it would be (`.../tasks/member`); an op points at its
    /// entry, `.../ops/get` in a mapping and `.../ops/1` in a list, which is also its origin,
    /// while its parent is its scope (ADR 0002 section 6, Surfaces and the tree).
    pub pointer: String,
    /// The parent node; none for a surface.
    pub parent: Option<TreeNodeId>,
    /// The node's mapping as written (an empty object for a scope not written and an op of an
    /// `ops` list).
    pub settings: &'raw JsonObject,
    /// The origin of the node: where it is written, or its parent's for a scope not written.
    pub origin: Origin,
}

/// Every node of the api's surfaces in document order.
#[derive(Debug, Clone, PartialEq)]
pub struct TreeNodes<'raw> {
    nodes: Vec<TreeNode<'raw>>,
}

impl<'raw> TreeNodes<'raw> {
    /// The nodes in document order.
    pub fn iter(&self) -> impl Iterator<Item = (TreeNodeId, &TreeNode<'raw>)> {
        self.nodes
            .iter()
            .enumerate()
            .map(|(index, node)| (TreeNodeId(index), node))
    }

    /// The node at `id`, which is one of this list's ids.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] for an id of another list.
    pub fn get(&self, id: TreeNodeId) -> Result<&TreeNode<'raw>, InternalError> {
        self.nodes
            .get(id.0)
            .ok_or_else(|| InternalError::new(format!("tree node {} is not in the list", id.0)))
    }

    /// The nodes from the root down to `id`.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] for an id of another list.
    pub fn chain(
        &self,
        id: TreeNodeId,
    ) -> Result<Vec<(TreeNodeId, &TreeNode<'raw>)>, InternalError> {
        let mut chain = Vec::new();
        let mut at = Some(id);

        while let Some(current) = at {
            let node = self.get(current)?;

            chain.push((current, node));
            at = node.parent;
        }

        chain.reverse();

        Ok(chain)
    }

    /// The number of nodes.
    #[must_use]
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    /// Whether the api has no surface node.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }
}

// ADR 0002 section 6: the scope of each op of a collection; a single's ops sit under the single.
const COLLECTION_SCOPE_OPS: [(&str, &[&str]); 2] = [
    ("collection", &["list", "create", "batch"]),
    ("member", &["get", "update", "delete"]),
];

static EMPTY: LazyLock<JsonObject> = LazyLock::new(JsonObject::new);

// The key of an op entry: its name in a mapping, its place in a list.
enum OpKey<'raw> {
    Name(&'raw str),
    Index(usize),
}

struct Builder<'raw> {
    raw: &'raw RawApi,
    nodes: Vec<TreeNode<'raw>>,
}

impl<'raw> Builder<'raw> {
    // `settings` absent: a scope not written, which takes its parent's origin.
    fn add(
        &mut self,
        kind: TreeNodeKind,
        name: &str,
        pointer: String,
        parent: Option<TreeNodeId>,
        settings: Option<&'raw JsonObject>,
    ) -> Result<TreeNodeId, InternalError> {
        let written = settings.and_then(|_| pipeline_origin(self.raw, &pointer));
        let origin = match written {
            Some(origin) => origin,
            None => self.fallback_origin(parent, &pointer)?,
        };
        let id = TreeNodeId(self.nodes.len());

        self.nodes.push(TreeNode {
            kind,
            name: name.to_owned(),
            pointer,
            parent,
            settings: settings.unwrap_or(&EMPTY),
            origin,
        });

        Ok(id)
    }

    fn fallback_origin(
        &self,
        parent: Option<TreeNodeId>,
        pointer: &str,
    ) -> Result<Origin, InternalError> {
        let Some(parent_id) = parent else {
            return Ok(Origin {
                api: None,
                layer: Layer::Api,
                pointer: pointer.to_owned(),
            });
        };
        let node = self
            .nodes
            .get(parent_id.0)
            .ok_or_else(|| InternalError::new("a tree node's parent is not built yet"))?;

        Ok(node.origin.clone())
    }

    // The op entries of `owner` that sit under `scope`: every entry of a single, a collection's by
    // its table. A list entry (`ops: [get]`) is written but has no settings; its origin is the
    // entry's.
    fn ops(
        &mut self,
        owner: TreeNodeId,
        scope: TreeNodeId,
        names: Option<&[&str]>,
    ) -> Result<(), InternalError> {
        let owner_node = self
            .nodes
            .get(owner.0)
            .ok_or_else(|| InternalError::new("an ops owner is not built yet"))?;
        let owner_pointer = owner_node.pointer.clone();
        let written = owner_node.settings.get("ops");
        let mut entries: Vec<(&'raw str, OpKey<'raw>, &'raw JsonObject)> = Vec::new();

        match written {
            Some(JsonValue::Array(items)) => {
                for (index, item) in items.iter().enumerate() {
                    if let JsonValue::String(op) = item {
                        entries.push((op, OpKey::Index(index), &EMPTY));
                    }
                }
            }
            Some(JsonValue::Object(object)) => {
                for (op, value) in object {
                    let settings = match value {
                        JsonValue::Object(settings) => settings,
                        _ => &EMPTY,
                    };

                    entries.push((op, OpKey::Name(op), settings));
                }
            }
            _ => {}
        }

        for (op, key, settings) in entries {
            if names.is_some_and(|listed| !listed.contains(&op)) {
                continue;
            }

            let key_text = match key {
                OpKey::Name(name) => name.to_owned(),
                OpKey::Index(index) => index.to_string(),
            };
            let pointer = pointer_below(&owner_pointer, &["ops", &key_text]);

            self.add(TreeNodeKind::Op, op, pointer, Some(scope), Some(settings))?;
        }

        Ok(())
    }

    fn routes(&mut self, parent: TreeNodeId) -> Result<(), InternalError> {
        let parent_node = self
            .nodes
            .get(parent.0)
            .ok_or_else(|| InternalError::new("a route parent is not built yet"))?;
        let parent_pointer = parent_node.pointer.clone();
        let Some(children) = parent_node.settings.object("routes") else {
            return Ok(());
        };

        for (name, child) in children {
            if let JsonValue::Object(settings) = child {
                let pointer = pointer_below(&parent_pointer, &["routes", name]);

                self.visit(name, pointer, parent, settings)?;
            }
        }

        Ok(())
    }

    fn visit(
        &mut self,
        name: &str,
        pointer: String,
        parent: TreeNodeId,
        settings: &'raw JsonObject,
    ) -> Result<(), InternalError> {
        if settings.contains_key("relays") {
            self.add(
                TreeNodeKind::Relay,
                name,
                pointer,
                Some(parent),
                Some(settings),
            )?;
        } else if settings.contains_key("method") {
            self.add(
                TreeNodeKind::Route,
                name,
                pointer,
                Some(parent),
                Some(settings),
            )?;
        } else if settings.string("kind") == Some("collection") {
            self.visit_collection(name, &pointer, parent, settings)?;
        } else if settings.string("kind") == Some("single") {
            let single = self.add(
                TreeNodeKind::Single,
                name,
                pointer,
                Some(parent),
                Some(settings),
            )?;

            self.ops(single, single, None)?;
            self.routes(single)?;
        }

        Ok(())
    }

    fn visit_collection(
        &mut self,
        name: &str,
        pointer: &str,
        parent: TreeNodeId,
        settings: &'raw JsonObject,
    ) -> Result<(), InternalError> {
        let collection = self.add(
            TreeNodeKind::Collection,
            name,
            pointer.to_owned(),
            Some(parent),
            Some(settings),
        )?;

        for (scope_name, scope_ops) in COLLECTION_SCOPE_OPS {
            let written = settings.object(scope_name);
            let scope = self.add(
                TreeNodeKind::Scope,
                scope_name,
                pointer_below(pointer, &[scope_name]),
                Some(collection),
                written,
            )?;

            self.ops(collection, scope, Some(scope_ops))?;
            self.routes(scope)?;
        }

        Ok(())
    }
}

/// Every node of the api's surfaces in document order (ADR 0002 section 6): a node before its
/// children, children in written order; a collection's `collection` scope then its `member` scope,
/// each followed by its op entries (in `ops` order) and then its routes; a single's op entries
/// before its routes. A node's `settings` is the raw tree's own mapping.
///
/// # Errors
///
/// An [`InternalError`] when a node refers to a parent that is not built.
pub fn pipeline_tree_nodes(raw: &RawApi) -> Result<TreeNodes<'_>, InternalError> {
    let mut builder = Builder {
        raw,
        nodes: Vec::new(),
    };

    if let Some(surfaces) = raw.merged.object("surfaces") {
        for (name, value) in surfaces {
            let JsonValue::Object(settings) = value else {
                continue;
            };
            let pointer = pointer_below("", &["surfaces", name]);
            let surface =
                builder.add(TreeNodeKind::Surface, name, pointer, None, Some(settings))?;

            builder.routes(surface)?;
        }
    }

    Ok(TreeNodes {
        nodes: builder.nodes,
    })
}
