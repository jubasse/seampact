//! The pass pipeline: half names, the draft IR, half outputs and their merge, the schema
//! service and the draft delta convention.
//!
//! A half reads the merged [`DraftIr`] by shared reference and returns an owned output; the
//! output's `merge_into` moves its values into the draft and refuses any write over a value
//! already set.

mod count;
mod delta;
mod draft;
mod halves;
mod outputs;
mod service;

pub use delta::{draft_apply, draft_delta};
pub use draft::{
    ApiDeclaration, DraftApi, DraftConcurrency, DraftIr, DraftOperation, DraftOperationInput,
};
pub use halves::{Half, PassName};
pub use outputs::{
    AccessIdentityOperation, AccessIdentityOutput, AccessRightsOperation, AccessRightsOutput,
    DeriveErrorsOutput, DeriveWireOperation, DeriveWireOutput, ProofOnlyInput,
    ResponseHeaderAdditions, SortKeyRights, TreeNodesConcurrency, TreeNodesInput,
    TreeNodesOperation, TreeNodesOutput, TreeNodesPaging, TreeNodesSortKey, TreeSchemasMembers,
    TreeSchemasOutput,
};
pub use service::{TreeSchemaExampleIssue, TreeSchemaService};
