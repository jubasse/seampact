//! The collection id checks: an id property each collection with an `id` names, and the idless collections.

use seampact_ir::Direction;
use seampact_pass_tree_shared::{
    tree_nodes_answered_use, tree_nodes_id_param, tree_nodes_object_of, tree_nodes_text,
};
use seampact_pipeline::{PassError, TreeNode, TreeNodeKind, pipeline_tree_nodes, pointer_below};

use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
    tree_nodes_report_once,
};
use crate::pass::TreeNodesScope;

/// Reports, once per collection, an operation in the member scope of a collection without `id`.
pub(crate) fn tree_nodes_report_idless_collection(
    node: &TreeNode<'_>,
    collection: &TreeNode<'_>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
        rule: TreeNodesRule::CollectionId,
        origin: tree_nodes_node_origin(&collection.origin)?,
        message: format!(
            "The collection {} declares no id, so the operation at {} in its member scope has no member path.",
            collection.name, node.pointer
        ),
        fix: format!(
            "Declare id on {}: its member id path parameter and schema.",
            collection.name
        ),
        related: Vec::new(),
    });

    tree_nodes_report_once(
        &format!("collection-id:{}", collection.pointer),
        diagnostic,
        scope,
    );

    Ok(())
}

/// Reports each collection whose item schema has no property named by its `idProperty` (or id parameter).
pub(crate) fn tree_nodes_check_id_properties(
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let raw = scope.context.raw;
    let draft = scope.draft;

    for (_, collection) in pipeline_tree_nodes(raw)?.iter() {
        if collection.kind != TreeNodeKind::Collection {
            continue;
        }

        let written = tree_nodes_text(collection, "idProperty");
        let id_property = written
            .map(str::to_owned)
            .or_else(|| tree_nodes_id_param(collection, raw.merged.get("schemas")));

        let Some(id_property) = id_property else {
            continue;
        };

        if !collection.settings.contains_key("item") {
            continue;
        }

        let item_use = tree_nodes_answered_use(
            scope.schemas,
            &format!("{}/item", collection.pointer),
            &Direction::Output,
        )?;
        let Some(item) = tree_nodes_object_of(draft, Some(&item_use)) else {
            continue;
        };

        if item
            .properties
            .iter()
            .any(|property| property.name == id_property)
        {
            continue;
        }

        let at = id_property_pointer(collection, &id_property, written);
        let origin = scope
            .context
            .origin(&at)
            .unwrap_or_else(|| collection.origin.clone());

        scope.context.report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::IdProperty,
            origin: tree_nodes_node_origin(&origin)?,
            message: format!(
                "The item {} of the collection {} has no property {id_property} to hold the member id.",
                item.id, collection.name
            ),
            fix: "Set idProperty to the item property that holds the id, or add that property to the item.".to_owned(),
            related: Vec::new(),
        }));
    }

    Ok(())
}
// `idProperty` when written, else the id parameter: its `id` entry, or the schema name `id` writes.
fn id_property_pointer(
    collection: &TreeNode<'_>,
    id_property: &str,
    written: Option<&str>,
) -> String {
    if written.is_some() {
        return pointer_below(&collection.pointer, &["idProperty"]);
    }

    let id_pointer = pointer_below(&collection.pointer, &["id"]);

    if tree_nodes_text(collection, "id").is_some() {
        return id_pointer;
    }

    pointer_below(&id_pointer, &[id_property])
}
