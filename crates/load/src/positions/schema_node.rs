//! A JSON Schema document as nodes with an identity: the shape the position reading walks.

use std::fmt;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

use indexmap::IndexMap;
use seampact_json::{JsonNumber, JsonObject, JsonValue};

/// The keywords whose value maps names to schemas.
const SCHEMA_MAP_KEYWORDS: [&str; 4] = [
    "properties",
    "patternProperties",
    "$defs",
    "dependentSchemas",
];

/// The keywords whose value lists schemas.
const SCHEMA_LIST_KEYWORDS: [&str; 4] = ["allOf", "anyOf", "oneOf", "prefixItems"];

/// The keywords whose value is one schema.
const SCHEMA_KEYWORDS: [&str; 7] = [
    "not",
    "if",
    "then",
    "else",
    "items",
    "additionalProperties",
    "propertyNames",
];

/// The file a node belongs to when it was not read from an authoring schema file: a schema given
/// to the reading directly, or a node the reading builds itself.
pub(super) const COMMON_FILE: &str = "common";

/// A JSON value inside a schema document; an object is a [`SchemaNode`], which has an identity.
#[derive(Debug, Clone)]
pub(super) enum SchemaValue {
    Null,
    Bool(bool),
    Number(JsonNumber),
    String(String),
    Array(Vec<SchemaValue>),
    Object(SchemaNode),
}

/// One object of a schema document, compared and hashed by identity as a JavaScript object is.
///
/// Members keep the key order of the document. The file is the authoring schema file the node
/// was read from, so that a `$ref` without a file resolves where it was written.
#[derive(Clone)]
pub(super) struct SchemaNode(Arc<NodeData>);

struct NodeData {
    file: &'static str,
    members: IndexMap<String, SchemaValue>,
}

impl SchemaNode {
    /// A node of `file` holding `members`.
    pub(super) fn new(file: &'static str, members: IndexMap<String, SchemaValue>) -> Self {
        Self(Arc::new(NodeData { file, members }))
    }

    /// A node of the common file holding one member: how the reading joins nodes it combined.
    pub(super) fn with_member(key: &str, value: SchemaValue) -> Self {
        Self::new(COMMON_FILE, IndexMap::from([(key.to_owned(), value)]))
    }

    /// The node a JSON object is, with every object below it a node of `file`.
    pub(super) fn from_object(file: &'static str, object: &JsonObject) -> Self {
        let members = object
            .iter()
            .map(|(key, value)| (key.clone(), SchemaValue::from_json(file, value)))
            .collect();

        Self::new(file, members)
    }

    /// The file the node was read from (`fileOf`).
    pub(super) fn file(&self) -> &'static str {
        self.0.file
    }

    /// The member `key`, when the node has it as its own.
    pub(super) fn member(&self, key: &str) -> Option<&SchemaValue> {
        self.0.members.get(key)
    }

    /// The members in the order of the document.
    pub(super) fn members(&self) -> impl Iterator<Item = (&String, &SchemaValue)> {
        self.0.members.iter()
    }

    /// The member `key` when it is a schema node (`isSchema(node[key])`).
    pub(super) fn node_member(&self, key: &str) -> Option<&SchemaNode> {
        self.member(key)?.as_node()
    }

    /// The member `key` when it is a list.
    pub(super) fn list_member(&self, key: &str) -> Option<&[SchemaValue]> {
        match self.member(key)? {
            SchemaValue::Array(items) => Some(items),
            _ => None,
        }
    }

    /// The member `key` when it is a string.
    pub(super) fn string_member(&self, key: &str) -> Option<&str> {
        match self.member(key)? {
            SchemaValue::String(text) => Some(text),
            _ => None,
        }
    }

    /// The member `key` when it is a number, as the `f64` JavaScript holds.
    pub(super) fn number_member(&self, key: &str) -> Option<f64> {
        match self.member(key)? {
            SchemaValue::Number(number) => Some(number.to_f64()),
            _ => None,
        }
    }

    /// The schema nodes the member `key` holds: its list members, or the node itself
    /// (`subschemas`). Anything that is no node is left out.
    pub(super) fn subschemas(&self, key: &str) -> Vec<SchemaNode> {
        match self.member(key) {
            Some(SchemaValue::Array(items)) => items
                .iter()
                .filter_map(SchemaValue::as_node)
                .cloned()
                .collect(),
            Some(SchemaValue::Object(node)) => vec![node.clone()],
            _ => Vec::new(),
        }
    }

    /// Calls `visit` on this node and on every schema below it, at the places a schema stands.
    pub(super) fn visit_schemas(&self, visit: &mut impl FnMut(&SchemaNode)) {
        visit(self);

        for child in self.schema_children() {
            child.visit_schemas(visit);
        }
    }

    fn schema_children(&self) -> Vec<SchemaNode> {
        let mut children = Vec::new();

        for (key, value) in self.members() {
            match value {
                SchemaValue::Object(object) if SCHEMA_MAP_KEYWORDS.contains(&key.as_str()) => {
                    children.extend(
                        object
                            .members()
                            .filter_map(|(_, member)| member.as_node().cloned()),
                    );
                }
                SchemaValue::Array(items) if SCHEMA_LIST_KEYWORDS.contains(&key.as_str()) => {
                    children.extend(items.iter().filter_map(SchemaValue::as_node).cloned());
                }
                SchemaValue::Object(object) if SCHEMA_KEYWORDS.contains(&key.as_str()) => {
                    children.push(object.clone());
                }
                _ => {}
            }
        }

        children
    }

    /// Whether the node is a conflict marker (`not: {}`): the key may not appear in this case,
    /// whatever its type (`isConflict`).
    pub(super) fn is_conflict(&self) -> bool {
        self.node_member("not")
            .is_some_and(|forbidden| forbidden.0.members.is_empty())
    }
}

impl SchemaValue {
    /// The value of a parsed JSON document, every object below it a node of `file`.
    pub(super) fn from_json(file: &'static str, value: &JsonValue) -> Self {
        match value {
            JsonValue::Null => Self::Null,
            JsonValue::Bool(flag) => Self::Bool(*flag),
            JsonValue::Number(number) => Self::Number(number.clone()),
            JsonValue::String(text) => Self::String(text.clone()),
            JsonValue::Array(items) => Self::Array(
                items
                    .iter()
                    .map(|item| Self::from_json(file, item))
                    .collect(),
            ),
            JsonValue::Object(object) => Self::Object(SchemaNode::from_object(file, object)),
        }
    }

    /// The node when the value is an object: a schema is no list and no scalar (`isSchema`).
    pub(super) fn as_node(&self) -> Option<&SchemaNode> {
        match self {
            Self::Object(node) => Some(node),
            _ => None,
        }
    }
}

impl PartialEq for SchemaNode {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

impl Eq for SchemaNode {}

impl Hash for SchemaNode {
    fn hash<H: Hasher>(&self, state: &mut H) {
        Arc::as_ptr(&self.0).hash(state);
    }
}

impl fmt::Debug for SchemaNode {
    /// Names the members only: a node of the authoring schemas holds a whole document.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SchemaNode")
            .field("file", &self.0.file)
            .field("members", &self.0.members.keys().collect::<Vec<_>>())
            .finish()
    }
}
