//! The input schemas an operation derives: the ids input of a `batch` op (derivation `batch.read`),
//! and the version property a body version source adds to a versioned write's input schema
//! (derivation `concurrency.version`). Both run once every route position is compiled.

use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_ir::{Direction, KnownTypeUseRef, Property, TypeUse};
use seampact_json::JsonValue;
use seampact_naming::{Role, derive_name};
use seampact_pass_tree_shared::{TreeNodesOperationName, tree_nodes_op_owner};
use seampact_pipeline::{PassError, ResolvedConventions, TreeNode, TreeNodeKind, TreeNodes};

use crate::compile::TreeSchemasCompiler;
use crate::not_ported::not_ported_yet;
use crate::raw::{
    TreeSchemasProblem, tree_schemas_is_object, tree_schemas_member, tree_schemas_pointer,
    tree_schemas_source_property,
};
use crate::rule::TreeSchemasRule;

const BATCH_OP: &str = "batch";
const VERSIONED_OPS: [&str; 2] = ["update", "delete"];
/// The prefix of a body version source, `body.<property>`.
const BODY_SOURCE_PREFIX: &str = "body.";
const INHERIT: &str = "inherit";

/// A versioned write: where its version is read and the item property it is compared with.
#[derive(Debug, Clone)]
struct Version<'tree, 'raw> {
    /// The version property of a body source; `None` for a query or header source.
    property: Option<String>,
    field: String,
    /// The collection or single that writes `concurrency`.
    owner: &'tree TreeNode<'raw>,
    /// The route's own `concurrency: inherit`, a source of the version property too.
    inherited: Option<String>,
}

#[derive(Debug, Clone)]
struct BodyRoute<'tree, 'raw> {
    pointer: String,
    version: Option<Version<'tree, 'raw>>,
}

/// Writes the ids input of each `batch` op without a declared `input`, and its use at the op entry.
pub(crate) fn tree_schemas_compile_batch_inputs(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    nodes: &TreeNodes<'_>,
    names: &IndexMap<String, TreeNodesOperationName>,
    conventions: &ResolvedConventions<'_>,
) -> Result<(), PassError> {
    for (_, node) in nodes.iter() {
        let Some(operation) = names.get(&node.pointer).map(|named| &named.name) else {
            continue;
        };

        if node.kind != TreeNodeKind::Op || node.name != BATCH_OP {
            continue;
        }

        if node.settings.contains_key("input") {
            continue;
        }

        if let Some(ids) = batch_ids(compiler, nodes, node, conventions)? {
            let name = derive_name(&operation.segments, Role::Input, None)
                .map_err(|error| PassError::from(InternalError::new(error.to_string())))?;

            compiler.derived_object(vec![ids], &node.pointer, &name, &[Direction::Input])?;
        }
    }

    Ok(())
}

fn batch_ids(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    nodes: &TreeNodes<'_>,
    node: &TreeNode<'_>,
    conventions: &ResolvedConventions<'_>,
) -> Result<Option<Property>, PassError> {
    Err(not_ported_yet("batchIds"))
}

fn id_type_of(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    collection: &TreeNode<'_>,
) -> Result<Option<TypeUse>, PassError> {
    Err(not_ported_yet("idTypeOf"))
}

/// `update` and `delete` take their resource's `concurrency`; a member route only with
/// `concurrency: inherit`.
fn version_of<'tree, 'raw>(
    nodes: &'tree TreeNodes<'raw>,
    node: &TreeNode<'raw>,
) -> Result<Option<Version<'tree, 'raw>>, PassError> {
    let owner = if node.kind == TreeNodeKind::Op {
        if VERSIONED_OPS.contains(&node.name.as_str()) {
            tree_nodes_op_owner(nodes, node)?
        } else {
            None
        }
    } else if matches!(node.settings.get("concurrency"), Some(JsonValue::String(text)) if text == INHERIT)
    {
        versioned_ancestor(nodes, node)?
    } else {
        None
    };
    let Some(owner) = owner else {
        return Ok(None);
    };
    let concurrency = owner.settings.get("concurrency");

    if !tree_schemas_is_object(concurrency) {
        return Ok(None);
    }

    let (
        Some(JsonValue::String(version)),
        Some(JsonValue::String(field)),
    ) = (
        tree_schemas_member(concurrency, "version"),
        tree_schemas_member(concurrency, "field"),
    )
    else {
        return Ok(None);
    };
    let inherited = if node.kind == TreeNodeKind::Op {
        None
    } else {
        Some(tree_schemas_pointer(&node.pointer, &["concurrency"]))
    };

    Ok(Some(Version {
        property: tree_schemas_source_property(version, BODY_SOURCE_PREFIX).map(str::to_owned),
        field: field.clone(),
        owner,
        inherited,
    }))
}

fn versioned_ancestor<'tree, 'raw>(
    nodes: &'tree TreeNodes<'raw>,
    node: &TreeNode<'raw>,
) -> Result<Option<&'tree TreeNode<'raw>>, PassError> {
    Err(not_ported_yet("versionedAncestor"))
}

/// Adds the version property of a body version source to the input schema of each versioned write,
/// after its authored properties. An input schema shared by routes that do not agree on that property
/// is refused.
pub(crate) fn tree_schemas_compile_version_properties(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    nodes: &TreeNodes<'_>,
    names: &IndexMap<String, TreeNodesOperationName>,
) -> Result<(), PassError> {
    let mut routes_by_schema: IndexMap<String, Vec<BodyRoute<'_, '_>>> = IndexMap::new();

    for (_, node) in nodes.iter() {
        check_version_field(compiler, node)?;
    }

    for (_, node) in nodes.iter() {
        if node.kind == TreeNodeKind::Relay || !names.contains_key(&node.pointer) {
            continue;
        }

        let pointer = tree_schemas_pointer(&node.pointer, &["input"]);
        let version = version_of(nodes, node)?;
        let Some(schema_use) = compiler.uses.get(&pointer) else {
            continue;
        };
        let target = match KnownTypeUseRef::try_from(schema_use)? {
            KnownTypeUseRef::Ref(reference)
                if compiler.object_properties(Some(schema_use))?.is_some() =>
            {
                Some(reference.schema.as_str().to_owned())
            }
            _ => None,
        };

        let Some(schema) = target else {
            if version
                .as_ref()
                .is_some_and(|written| written.property.is_some())
            {
                refuse_non_object_input(compiler, &pointer)?;
            }

            continue;
        };

        routes_by_schema
            .entry(schema)
            .or_default()
            .push(BodyRoute { pointer, version });
    }

    for (schema, routes) in &routes_by_schema {
        add_version_property(compiler, schema, routes)?;
    }

    Ok(())
}

fn refuse_non_object_input(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    pointer: &str,
) -> Result<(), PassError> {
    Err(not_ported_yet("refuseNonObjectInput"))
}

fn add_version_property(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    schema: &str,
    routes: &[BodyRoute<'_, '_>],
) -> Result<(), PassError> {
    Err(not_ported_yet("addVersionProperty"))
}

fn use_outside_inputs(
    compiler: &TreeSchemasCompiler<'_, '_, '_>,
    schema: &str,
    routes: &[BodyRoute<'_, '_>],
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("useOutsideInputs"))
}

fn refers_to_schema(value: &JsonValue, schema: &str) -> Result<bool, PassError> {
    Err(not_ported_yet("refersToSchema"))
}

/// The item of a `concurrency` owner has the property `field`, whatever the version source.
fn check_version_field(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    owner: &TreeNode<'_>,
) -> Result<(), PassError> {
    let concurrency = owner.settings.get("concurrency");
    let Some(JsonValue::String(field)) = tree_schemas_member(concurrency, "field") else {
        return Ok(());
    };
    let item_pointer = tree_schemas_pointer(&owner.pointer, &["item"]);

    // A written item that did not compile is reported where it is written.
    if owner.settings.contains_key("item") && !compiler.uses.contains_key(&item_pointer) {
        return Ok(());
    }

    if item_property(compiler, owner, field)?.is_some() {
        return Ok(());
    }

    compiler.reporter.error(TreeSchemasProblem {
        rule: TreeSchemasRule::ConcurrencyField,
        pointer: tree_schemas_pointer(&owner.pointer, &["concurrency", "field"]),
        message: format!("the item has no property '{field}' to compare the version with"),
        fix: "name a property of the item schema in 'field'".to_owned(),
        related: None,
    })
}

fn item_property(
    compiler: &TreeSchemasCompiler<'_, '_, '_>,
    owner: &TreeNode<'_>,
    field: &str,
) -> Result<Option<Property>, PassError> {
    Err(not_ported_yet("itemProperty"))
}

fn field_type(
    compiler: &TreeSchemasCompiler<'_, '_, '_>,
    version: &Version<'_, '_>,
) -> Result<Option<TypeUse>, PassError> {
    Err(not_ported_yet("fieldType"))
}
