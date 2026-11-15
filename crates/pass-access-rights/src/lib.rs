//! The `access.rights` half (ADR 0006 section 2), ported from
//! `packages/core/compiler/src/passes/access/rights`.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the half's last brief"
)]

mod bucket_keys;
mod catalogues;
mod field_rights;
mod field_subjects;
mod filtered_by;
mod not_ported;
mod packs;
mod params;
mod pass;
mod proofs;
mod read;
mod report;
mod requires;
mod restricted_fields;
mod restricted_positions;
mod restrictions;
mod routes;
mod schema_use;
mod scopes;
mod sort_keys;
mod source;
mod subjects;

use seampact_diagnostics::RuleId;
use seampact_ir::IrMap;
use seampact_pipeline::{
    AccessRightsOperation, AccessRightsOutput, DraftIr, HalfContext, PassError, TreeSchemaService,
    pipeline_tree_nodes,
};

use crate::report::AccessRightsRule;
use crate::schema_use::AccessRightsContext;

/// Every rule id the half reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[
    AccessRightsRule::RightName.rule_id(),
    AccessRightsRule::RightPattern.rule_id(),
    AccessRightsRule::RightSubject.rule_id(),
    AccessRightsRule::ProofSchema.rule_id(),
    AccessRightsRule::ProofName.rule_id(),
    AccessRightsRule::ProofInput.rule_id(),
    AccessRightsRule::SignedInput.rule_id(),
    AccessRightsRule::ScopeWithin.rule_id(),
    AccessRightsRule::BucketKey.rule_id(),
    AccessRightsRule::BucketWindow.rule_id(),
    AccessRightsRule::ScopeUnknown.rule_id(),
    AccessRightsRule::ScopeTwice.rule_id(),
    AccessRightsRule::ScopeNesting.rule_id(),
    AccessRightsRule::RequirementEntry.rule_id(),
    AccessRightsRule::RequirementTarget.rule_id(),
    AccessRightsRule::RequirementParams.rule_id(),
    AccessRightsRule::RequirementBucket.rule_id(),
    AccessRightsRule::RequirementSubject.rule_id(),
    AccessRightsRule::RequirementTwice.rule_id(),
    AccessRightsRule::GuestRight.rule_id(),
    AccessRightsRule::CallerRight.rule_id(),
    AccessRightsRule::PackTemplate.rule_id(),
    AccessRightsRule::PackRight.rule_id(),
    AccessRightsRule::FieldRightTarget.rule_id(),
    AccessRightsRule::FieldRightParams.rule_id(),
    AccessRightsRule::FieldRightSubject.rule_id(),
    AccessRightsRule::FieldRightRecursive.rule_id(),
    AccessRightsRule::FieldRightConflict.rule_id(),
    AccessRightsRule::FieldRightPosition.rule_id(),
    AccessRightsRule::FieldRightLimit.rule_id(),
    AccessRightsRule::SortKeyRight.rule_id(),
    AccessRightsRule::FilteredBy.rule_id(),
];

/// Runs `access.rights` over the draft, reading schemas through the service `tree.schemas` built.
///
/// # Errors
///
/// [`PassError::NotPortedYet`] when the run reaches a function not ported yet, else
/// [`PassError::Internal`] for a bug.
pub fn run(
    draft: &DraftIr,
    context: &mut HalfContext<'_>,
    schemas: &dyn TreeSchemaService,
) -> Result<AccessRightsOutput, PassError> {
    let nodes = pipeline_tree_nodes(context.raw)?;
    let mut scope = AccessRightsContext {
        draft,
        context,
        schemas,
        nodes,
        output: AccessRightsOutput {
            rights: IrMap::new(),
            rules: IrMap::new(),
            scopes: IrMap::new(),
            buckets: IrMap::new(),
            operations: vec![AccessRightsOperation::default(); draft.operations.len()],
        },
    };

    pass::access_rights_run(&mut scope)?;

    Ok(scope.output)
}
