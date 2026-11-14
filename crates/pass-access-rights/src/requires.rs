//! The requirements of a route: written and pack-derived, each target, params, subject and
//! bucket checked (ADR 0002 section 9).

use std::collections::HashMap;

use seampact_ir::{DerivedFrom, OperationScope, Origin, Requirement, Rule};
use seampact_json::JsonValue;
use seampact_pipeline::PassError;

use crate::catalogues::AccessRightsCatalogues;
use crate::not_ported::not_ported_yet;
use crate::packs::AccessRightsDeriveEntry;
use crate::params::AccessRightsCheckedParams;
use crate::report::AccessRightsReporter;
use crate::restricted_fields::AccessRightsDraftSchemas;
use crate::routes::{AccessRightsApi, AccessRightsRoute};
use crate::schema_use::AccessRightsContext;

/// What a requirement item names: a right or a rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RequirementKind {
    Right,
    Rule,
}

/// The kind and name a requirement item targets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RequirementTarget {
    pub(crate) kind: RequirementKind,
    pub(crate) target: String,
}

/// One requirement item, written or derived, before its checks.
#[derive(Debug, Clone)]
pub(crate) struct RequirementUse<'run> {
    pub(crate) kind: RequirementKind,
    pub(crate) target: String,
    pub(crate) item: &'run JsonValue,
    pub(crate) item_pointer: String,
    pub(crate) use_pointer: String,
    pub(crate) entry: Option<String>,
    pub(crate) origin: Option<Origin>,
    pub(crate) derived_from: Option<DerivedFrom>,
}

/// What one route's requirements need besides the catalogues.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsRequiresInput<'run, 'draft> {
    pub(crate) route: &'draft AccessRightsRoute,
    pub(crate) scopes: &'draft [OperationScope],
    pub(crate) api: &'draft AccessRightsApi,
    pub(crate) entries: &'draft [AccessRightsDeriveEntry<'run>],
    pub(crate) schemas: &'draft AccessRightsDraftSchemas,
}

/// Requirement items checked once each, whatever the number of routes they apply to: the target,
/// its params and its bucket. A failed item is remembered as `None`, so its uses add no error.
#[derive(Debug, Clone, Default)]
pub(crate) struct AccessRightsItemChecks {
    pub(crate) checked: HashMap<String, Option<AccessRightsCheckedParams>>,
}

/// A requirement built from a use, with the key that finds its repeats.
#[derive(Debug, Clone)]
pub(crate) struct BuiltRequirement<'run> {
    pub(crate) use_of: RequirementUse<'run>,
    pub(crate) requirement: Requirement,
    pub(crate) key: String,
}

pub(crate) fn access_rights_item_checks() -> Result<AccessRightsItemChecks, PassError> {
    Err(not_ported_yet("accessRightsItemChecks"))
}

pub(crate) fn access_rights_requirements(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _checks: &mut AccessRightsItemChecks,
    _input: &AccessRightsRequiresInput<'_, '_>,
) -> Result<Vec<Requirement>, PassError> {
    Err(not_ported_yet("accessRightsRequirements"))
}

pub(crate) fn access_rights_check_requirement_entries(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _checks: &mut AccessRightsItemChecks,
) -> Result<(), PassError> {
    Err(not_ported_yet("accessRightsCheckRequirementEntries"))
}

pub(crate) fn derived_uses<'run>(
    _context: &AccessRightsContext<'_, '_, 'run>,
    _reporter: &mut AccessRightsReporter,
    _input: &AccessRightsRequiresInput<'run, '_>,
) -> Result<Vec<RequirementUse<'run>>, PassError> {
    Err(not_ported_yet("derivedUses"))
}

pub(crate) fn derived_target(
    _reporter: &mut AccessRightsReporter,
    _require: &JsonValue,
    _pointer: &str,
    _route: &AccessRightsRoute,
) -> Result<Option<RequirementTarget>, PassError> {
    Err(not_ported_yet("derivedTarget"))
}

pub(crate) fn written_uses<'run>(
    _context: &AccessRightsContext<'_, '_, 'run>,
    _reporter: &mut AccessRightsReporter,
    _input: &AccessRightsRequiresInput<'run, '_>,
) -> Result<Vec<RequirementUse<'run>>, PassError> {
    Err(not_ported_yet("writtenUses"))
}

pub(crate) fn target_of(_item: &JsonValue, _pointer: &str) -> Result<RequirementTarget, PassError> {
    Err(not_ported_yet("targetOf"))
}

pub(crate) fn check_item(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _checks: &mut AccessRightsItemChecks,
    _use: &RequirementUse<'_>,
) -> Result<Option<AccessRightsCheckedParams>, PassError> {
    Err(not_ported_yet("checkItem"))
}

pub(crate) fn check_target_and_params(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _use: &RequirementUse<'_>,
) -> Result<Option<AccessRightsCheckedParams>, PassError> {
    Err(not_ported_yet("checkTargetAndParams"))
}

pub(crate) fn check_bucket(
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _use: &RequirementUse<'_>,
    _rule: Option<&Rule>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("checkBucket"))
}

pub(crate) fn requirement_of(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _input: &AccessRightsRequiresInput<'_, '_>,
    _use: &RequirementUse<'_>,
    _params: Option<&JsonValue>,
) -> Result<Option<Requirement>, PassError> {
    Err(not_ported_yet("requirementOf"))
}

pub(crate) fn check_guest(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _route: &AccessRightsRoute,
    _right: &seampact_ir::Right,
    _use: &RequirementUse<'_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("checkGuest"))
}

pub(crate) fn equality_key(_requirement: &Requirement) -> Result<String, PassError> {
    Err(not_ported_yet("equalityKey"))
}

pub(crate) fn without_repeats(
    _reporter: &mut AccessRightsReporter,
    _built: &[BuiltRequirement<'_>],
) -> Result<Vec<Requirement>, PassError> {
    Err(not_ported_yet("withoutRepeats"))
}

pub(crate) fn check_caller_right(
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _input: &AccessRightsRequiresInput<'_, '_>,
    _requirements: &[Requirement],
) -> Result<(), PassError> {
    Err(not_ported_yet("checkCallerRight"))
}
