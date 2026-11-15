//! The collection id checks: an id property each collection with an `id` names, and the idless collections.

use seampact_ir::Direction;
use seampact_pass_tree_shared::{
    tree_nodes_answered_use, tree_nodes_id_param, tree_nodes_object_of, tree_nodes_text,
};
use seampact_pipeline::{PassError, TreeNode, TreeNodeKind, pipeline_tree_nodes};

use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
};

use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;

pub(crate) fn tree_nodes_report_idless_collection(
    _node: &TreeNode<'_>,
    _collection: &TreeNode<'_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("treeNodesReportIdlessCollection"))
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

        let at = id_property_pointer(collection, &id_property, written)?;
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
fn id_property_pointer(
    _collection: &TreeNode<'_>,
    _id_property: &str,
    _written: Option<&str>,
) -> Result<String, PassError> {
    Err(not_ported_yet("idPropertyPointer"))
}
