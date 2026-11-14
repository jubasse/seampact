//! The `tree.nodes` code an earlier half reaches: `tree.schemas` runs before `tree.nodes` and
//! names inline route schemas with [`tree_nodes_operation_names`], reads the raw tree with
//! [`tree_nodes_member`] and its siblings and stamps relayed elements with
//! [`tree_nodes_relay_origin`].

mod names;
mod raw;
mod relays;

pub use names::{
    TREE_NODES_BATCH_OP, TREE_NODES_DELETE_OP, TREE_NODES_LIST_OP, TreeNodesOperationName,
    TreeNodesRawSchemas, tree_nodes_id_param, tree_nodes_idless_collection,
    tree_nodes_is_operation, tree_nodes_op_owner, tree_nodes_op_shorthand,
    tree_nodes_operation_name, tree_nodes_operation_names, tree_nodes_singular_is_bare_id,
    tree_nodes_singular_owner,
};
pub use raw::{
    TREE_NODES_MATURITIES, WrittenConvention, tree_nodes_answered_use, tree_nodes_draft_schema,
    tree_nodes_member, tree_nodes_object_of, tree_nodes_origin_at, tree_nodes_schema,
    tree_nodes_setting, tree_nodes_tag_header, tree_nodes_text, tree_nodes_written_convention,
};
pub use relays::{TREE_NODES_OPERATION_KIND, tree_nodes_relay_origin};
