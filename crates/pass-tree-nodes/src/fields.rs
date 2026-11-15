//! The fields of a form, multipart or fields map, and the site every check of an operation reports at.

use seampact_ir::{Direction, Origin, TypeUse};
use seampact_json::JsonValue;
use seampact_pipeline::{PassError, TreeNode, TreeNodeId};

use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;

/// The suffix of a field name that makes the field optional.
const OPTIONAL_SUFFIX: &str = "?";
/// The member a field's default is written under.
const DEFAULT_KEY: &str = "default";
/// The kinds of type that never sit in a query, a path parameter or a header, nor do their lists, with how
/// a message names them.
const TEXTLESS_KINDS: &[(&str, &str)] = &[("opaque", "an opaque value"), ("file", "a file")];

/// The operation a check reports for: its tree node and id.
///
/// The draft, the context and the report-once registry the TypeScript site carries are the scope, which every
/// function takes beside the site.
#[derive(Debug, Clone)]
pub(crate) struct TreeNodesSite<'node, 'raw> {
    pub(crate) node_id: TreeNodeId,
    pub(crate) node: &'node TreeNode<'raw>,
    pub(crate) operation_id: String,
}

/// A field of an input, a path, a query or a headers map.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TreeNodesField {
    pub(crate) name: String,
    pub(crate) required: bool,
    pub(crate) field_type: TypeUse,
    /// The `default` written on the field or its property, absent when none is.
    pub(crate) default: Option<JsonValue>,
    pub(crate) origin: Origin,
    /// Where the schema service answers the field's query wire.
    pub(crate) wire_pointer: String,
}

/// The fields read, and whether the read reached all of them.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TreeNodesFields {
    pub(crate) fields: Vec<TreeNodesField>,
    pub(crate) complete: bool,
}

pub(crate) fn tree_nodes_fields(
    _site: &TreeNodesSite<'_, '_>,
    _written: Option<&JsonValue>,
    _pointer: &str,
    _direction: &Direction,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<TreeNodesFields, PassError> {
    Err(not_ported_yet("treeNodesFields"))
}

fn named_schema_fields(
    _site: &TreeNodesSite<'_, '_>,
    _schema_name: &str,
    _pointer: &str,
    _direction: &Direction,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<TreeNodesFields, PassError> {
    Err(not_ported_yet("namedSchemaFields"))
}

pub(crate) fn tree_nodes_field_travels(
    _site: &TreeNodesSite<'_, '_>,
    _field: &TreeNodesField,
    _place: &str,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("treeNodesFieldTravels"))
}

pub(crate) fn tree_nodes_innermost(
    _type_use: Option<&TypeUse>,
) -> Result<Option<TypeUse>, PassError> {
    Err(not_ported_yet("treeNodesInnermost"))
}
