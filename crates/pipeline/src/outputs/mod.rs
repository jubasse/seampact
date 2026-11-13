//! The six half outputs and their merge into the draft.
//!
//! Each output holds only the fields ADR 0006 section 3 gives its half, and its `merge_into`
//! moves them into the draft under the rules of [`merge`]; a half cannot write another half's
//! field because its output type has none.

mod access_identity;
mod access_rights;
mod derive_errors;
mod derive_wire;
mod merge;
mod tree_nodes;
mod tree_schemas;

pub use access_identity::{AccessIdentityOperation, AccessIdentityOutput};
pub use access_rights::{AccessRightsOperation, AccessRightsOutput, ProofOnlyInput, SortKeyRights};
pub use derive_errors::DeriveErrorsOutput;
pub use derive_wire::{DeriveWireOperation, DeriveWireOutput, ResponseHeaderAdditions};
pub use tree_nodes::{
    TreeNodesConcurrency, TreeNodesInput, TreeNodesOperation, TreeNodesOutput, TreeNodesPaging,
    TreeNodesSortKey,
};
pub use tree_schemas::{TreeSchemasMembers, TreeSchemasOutput};
