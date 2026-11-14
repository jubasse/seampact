//! The pass pipeline: half names, the draft IR, half outputs and their merge, the derivation
//! table, the schema service, the draft delta convention, the readers over the loaded tree and the
//! half context.
//!
//! A half reads the merged [`DraftIr`] by shared reference and returns an owned output; the
//! output's `merge_into` moves its values into the draft and refuses any write over a value
//! already set.

mod context;
mod delta;
mod derivations;
mod draft;
mod error;
mod halves;
mod outputs;
mod readers;
mod service;

pub use context::{HalfContext, RelayedDrafts};
pub use delta::{draft_apply, draft_delta};
pub use derivations::{
    DERIVATION_TABLE, DatumRequired, DerivationRole, DerivationRoles, DerivationRow,
    EMPTY_BODY_SCHEMA_ID, ISSUE_SCHEMA_ID, IssueLocation, IssueMember, PACK_DERIVATION_ROW,
    RoleDatum, derivation_datum_always, derivation_issue_members, derivation_param_of_datum,
    derivation_params_schema_id, derivation_role_of, derivation_roles, derivation_row_of,
    is_derivation_id,
};
pub use draft::{
    ApiDeclaration, DraftApi, DraftConcurrency, DraftIr, DraftOperation, DraftOperationInput,
};
pub use error::PassError;
pub use halves::{Half, LaterHalf, PassName};
pub use outputs::{
    AccessIdentityOperation, AccessIdentityOutput, AccessRightsOperation, AccessRightsOutput,
    DeriveErrorsOutput, DeriveWireOperation, DeriveWireOutput, OperationIndex, ProofOnlyInput,
    ResponseHeaderAdditions, SortKeyRights, TreeNodesConcurrency, TreeNodesInput,
    TreeNodesOperation, TreeNodesOutput, TreeNodesPaging, TreeNodesSortKey, TreeSchemasMembers,
    TreeSchemasOutput,
};
pub use readers::{
    ConventionDefault, ConventionDefaultValue, ConventionReading, Inherited, InheritedEntry,
    NearestSetting, OrderedSetting, PerKeySetting, PipelineDeclared, ResolvedConventions,
    SENSITIVE_ELSEWHERE_REFUSE, TreeNode, TreeNodeId, TreeNodeKind, TreeNodes, UnionSetting,
    UnitKind, convention_defaults, convention_schema_leaves, is_json_list, is_json_object, json_at,
    json_at_object, json_at_pointer, parse_duration, parse_size, pipeline_conventions,
    pipeline_declared, pipeline_origin, pipeline_rate_limit_param, pipeline_tree_nodes,
    pointer_below, unit_pattern, unit_table,
};
pub use service::{TreeSchemaExampleIssue, TreeSchemaService};
