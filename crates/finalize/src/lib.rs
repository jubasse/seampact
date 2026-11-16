//! The finalize stage: the complete draft of one api to its canonical IR and its side table.
//!
//! [`finalize`] prunes the draft to the declarations an operation, an identity or a convention
//! reaches, refuses an id collision with a diagnostic, sorts the IR's arrays in their canonical
//! order, writes the members finalize owns, checks the result against the strict IR schema and
//! builds the source map. It works on the JSON form of the draft, as the TypeScript works on a
//! generic object, and decodes the checked IR into [`seampact_ir::ContractIr`] at the end.

mod canonical_order;
mod collisions;
mod context;
mod finalize;
mod json_origin;
mod members;
mod prune;
mod record;
mod serialize;
mod source_map;
mod validate;

pub use canonical_order::{finalize_canonical_order, finalize_sorted_array_rows};
pub use collisions::{FINALIZE_ID_COLLISION_RULE, RULE_IDS, finalize_id_collisions};
pub use context::{FinalizeContext, PackFileParts, PackFiles};
pub use finalize::{Finalized, finalize};
pub use members::{
    FEATURE_TABLE, FeatureRow, FinalizeMembers, finalize_members, finalize_operation_features,
};
pub use prune::finalize_prune;
pub use serialize::{finalize_canonical_ir, finalize_serialize_ir};
pub use source_map::finalize_source_map;
pub use validate::{finalize_assert_ir, finalize_assert_source_map};
