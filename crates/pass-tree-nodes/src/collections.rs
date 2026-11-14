//! The collection id checks: an id property each collection with an `id` names, and the idless collections.

use seampact_pipeline::{PassError, TreeNode};

use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;

pub(crate) fn tree_nodes_report_idless_collection(
    _node: &TreeNode<'_>,
    _collection: &TreeNode<'_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("treeNodesReportIdlessCollection"))
}

pub(crate) fn tree_nodes_check_id_properties(
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("treeNodesCheckIdProperties"))
}

fn id_property_pointer(
    _collection: &TreeNode<'_>,
    _id_property: &str,
    _written: Option<&str>,
) -> Result<String, PassError> {
    Err(not_ported_yet("idPropertyPointer"))
}
