//! The fields of a form, multipart or fields map, and the site every check of an operation reports at.

use seampact_ir::{Direction, Origin, TypeUse};
use seampact_js::js_key_order;
use seampact_json::JsonValue;
use seampact_pass_tree_shared::{tree_nodes_answered_use, tree_nodes_member, tree_nodes_object_of};
use seampact_pipeline::{PassError, TreeNode, TreeNodeId, TreeNodes, pointer_below};

use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_locate,
    tree_nodes_node_origin, tree_nodes_report_once,
};
use crate::pass::TreeNodesScope;

/// The suffix of a field name that makes the field optional.
const OPTIONAL_SUFFIX: &str = "?";
/// The member a field's default is written under.
const DEFAULT_KEY: &str = "default";
/// How a message names an opaque value, which never sits in a query, a path parameter or a header, nor does a list of them.
const OPAQUE_PHRASE: &str = "an opaque value";
/// How a message names a file, which never sits in a query, a path parameter or a header, nor does a list of them.
const FILE_PHRASE: &str = "a file";

/// The operation a check reports for: its tree node, the tree it sits in and its id.
///
/// The draft, the context and the report-once registry the TypeScript site carries are the scope, which every
/// function takes beside the site.
#[derive(Debug, Clone)]
pub(crate) struct TreeNodesSite<'node, 'raw> {
    pub(crate) node_id: TreeNodeId,
    pub(crate) node: &'node TreeNode<'raw>,
    pub(crate) nodes: &'node TreeNodes<'raw>,
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

/// The fields of the map written at `pointer`, each schema compiled in `direction`.
pub(crate) fn tree_nodes_fields(
    site: &TreeNodesSite<'_, '_>,
    written: Option<&JsonValue>,
    pointer: &str,
    direction: &Direction,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<TreeNodesFields, PassError> {
    let map = match written {
        Some(JsonValue::String(schema_name)) => {
            return named_schema_fields(site, schema_name, pointer, direction, scope);
        }
        Some(JsonValue::Object(map)) => map,
        _ => {
            return Ok(TreeNodesFields {
                fields: Vec::new(),
                complete: true,
            });
        }
    };
    let mut fields = Vec::with_capacity(map.len());

    for (key, entry) in js_key_order(map.iter()) {
        let field_pointer = pointer_below(pointer, &[key]);
        let name = key.strip_suffix(OPTIONAL_SUFFIX);
        let default = tree_nodes_member(Some(entry), DEFAULT_KEY).cloned();

        fields.push(TreeNodesField {
            name: name.unwrap_or(key).to_owned(),
            required: name.is_none(),
            field_type: tree_nodes_answered_use(scope.schemas, &field_pointer, direction)?,
            default,
            origin: scope
                .context
                .origin(&field_pointer)
                .unwrap_or_else(|| site.node.origin.clone()),
            wire_pointer: field_pointer,
        });
    }

    Ok(TreeNodesFields {
        fields,
        complete: true,
    })
}

// `query: TaskQuery`: the properties of the named object schema, each asked for its wire at its position there.
fn named_schema_fields(
    site: &TreeNodesSite<'_, '_>,
    schema_name: &str,
    pointer: &str,
    direction: &Direction,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<TreeNodesFields, PassError> {
    let used = tree_nodes_answered_use(scope.schemas, pointer, direction)?;
    let Some(schema) = tree_nodes_object_of(scope.draft, Some(&used)) else {
        let origin = scope
            .context
            .origin(pointer)
            .unwrap_or_else(|| site.node.origin.clone());
        let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::FieldsSchema,
            origin: tree_nodes_node_origin(&origin)?,
            message: format!(
                "The fields at {pointer} name {schema_name}, which is not an object schema, so it has no fields."
            ),
            fix: "Name an object schema, or write the fields as a map.".to_owned(),
            related: Vec::new(),
        });

        tree_nodes_report_once(&format!("fields-schema:{pointer}"), diagnostic, scope);

        return Ok(TreeNodesFields {
            fields: Vec::new(),
            complete: false,
        });
    };
    let schema_pointer = pointer_below("/schemas", &[schema.id.as_str()]);
    let fields = schema
        .properties
        .iter()
        .map(|property| TreeNodesField {
            name: property.name.clone(),
            required: !property.optional,
            field_type: property.r#type.clone(),
            default: property.default.clone(),
            origin: property.origin.clone(),
            wire_pointer: pointer_below(&schema_pointer, &["properties", &property.name]),
        })
        .collect();

    Ok(TreeNodesFields {
        fields,
        complete: true,
    })
}

/// Whether a field may travel in a parameter or a header: an opaque value or a file, or a list of them, has no
/// text form. Reports the field otherwise.
pub(crate) fn tree_nodes_field_travels(
    site: &TreeNodesSite<'_, '_>,
    field: &TreeNodesField,
    place: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<bool, PassError> {
    let node_origin = tree_nodes_node_origin(&site.node.origin)?;
    let origin = tree_nodes_locate(&field.origin, &node_origin);
    let key = format!("{}#{}:{}", origin.layer, origin.pointer, field.name);
    let Some(textless) = tree_nodes_innermost(Some(&field.field_type)).and_then(textless_phrase)
    else {
        return Ok(true);
    };
    let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
        rule: TreeNodesRule::OpaquePosition,
        origin,
        message: format!(
            "The {place} {} of {} is {textless}, which has no text form.",
            field.name, site.operation_id
        ),
        fix: "Give it a schema with a text form, or move it into the body.".to_owned(),
        related: Vec::new(),
    });

    tree_nodes_report_once(&format!("opaque-position:{key}"), diagnostic, scope);

    Ok(false)
}

/// How a message names a kind of type that has no text form.
fn textless_phrase(type_use: &TypeUse) -> Option<&'static str> {
    match type_use {
        TypeUse::Opaque(_) => Some(OPAQUE_PHRASE),
        TypeUse::File(_) => Some(FILE_PHRASE),
        _ => None,
    }
}

/// The innermost item of a list use: a list of files is still a file in an item position.
pub(crate) fn tree_nodes_innermost(type_use: Option<&TypeUse>) -> Option<&TypeUse> {
    let mut at = type_use;

    while let Some(TypeUse::Array(array)) = at {
        at = Some(&array.items);
    }

    at
}
