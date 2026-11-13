//! The pass pipeline: half names, the draft IR, half outputs and their merge, the derivation
//! table, the schema service and the draft delta convention.
//!
//! A half reads the merged [`DraftIr`] by shared reference and returns an owned output; the
//! output's `merge_into` moves its values into the draft and refuses any write over a value
//! already set.

mod count;
mod delta;
mod derivations;
mod draft;
mod halves;
mod outputs;
mod service;

pub use delta::{draft_apply, draft_delta};
pub use derivations::{
    DERIVATION_TABLE, DatumRequired, DerivationRole, DerivationRoles, DerivationRow,
    EMPTY_BODY_SCHEMA_ID, ISSUE_SCHEMA_ID, IssueLocation, IssueMember, PACK_DERIVATION_ROW,
    RoleDatum, derivation_datum_always, derivation_issue_members, derivation_param_of_datum,
    derivation_role_of, derivation_roles, derivation_row_of, is_derivation_id,
};
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
