//! The `fieldRights` of a route: one entry per restricted field its input and output reach.

use std::cmp::Ordering;

use seampact_ir::{Direction, FieldRestriction, FieldRight, FieldRightSubject, InputPolicy};
use seampact_pipeline::PassError;

use crate::catalogues::AccessRightsCatalogues;
use crate::field_subjects::AccessRightsFieldRoute;
use crate::not_ported::not_ported_yet;
use crate::report::AccessRightsReporter;
use crate::restricted_fields::{AccessRightsDraftSchemas, AccessRightsRestrictedField};
use crate::restrictions::{AccessRightsCheckedRestriction, AccessRightsRestrictionChecks};
use crate::schema_use::AccessRightsContext;

/// A route with the scopes it enters and the schemas its fields are read from.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsFieldRightsInput<'draft> {
    pub(crate) field_route: AccessRightsFieldRoute,
    pub(crate) schemas: &'draft AccessRightsDraftSchemas,
}

/// One restricted field reached in one direction.
#[derive(Debug, Clone)]
pub(crate) struct Reached<'draft> {
    pub(crate) field: AccessRightsRestrictedField<'draft>,
    pub(crate) direction: Direction,
}

pub(crate) fn access_rights_field_rights(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _checks: &mut AccessRightsRestrictionChecks,
    _input: &AccessRightsFieldRightsInput<'_>,
) -> Result<Vec<FieldRight>, PassError> {
    Err(not_ported_yet("accessRightsFieldRights"))
}

pub(crate) fn entry_of(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _checks: &mut AccessRightsRestrictionChecks,
    _input: &AccessRightsFieldRightsInput<'_>,
    _reached: &Reached<'_>,
) -> Result<Option<FieldRight>, PassError> {
    Err(not_ported_yet("entryOf"))
}

pub(crate) fn same_entry(
    _left: Option<&FieldRight>,
    _right: Option<&FieldRight>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("sameEntry"))
}

pub(crate) fn report_conflict(
    _reporter: &mut AccessRightsReporter,
    _input: &AccessRightsFieldRightsInput<'_>,
    _uses: &[Reached<'_>],
    _conflicting: usize,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportConflict"))
}

pub(crate) fn field_right_of(
    _context: &AccessRightsContext,
    _field: &AccessRightsRestrictedField<'_>,
    _direction: &Direction,
    _checked: &AccessRightsCheckedRestriction,
    _subject: Option<&FieldRightSubject>,
) -> Result<FieldRight, PassError> {
    Err(not_ported_yet("fieldRightOf"))
}

pub(crate) fn compared(_left: &str, _right: &str) -> Result<Ordering, PassError> {
    Err(not_ported_yet("compared"))
}

pub(crate) fn by_location(
    _left: &[Reached<'_>],
    _right: &[Reached<'_>],
) -> Result<Ordering, PassError> {
    Err(not_ported_yet("byLocation"))
}

pub(crate) fn input_policy_of(
    _context: &AccessRightsContext,
    _restriction: &FieldRestriction,
) -> Result<InputPolicy, PassError> {
    Err(not_ported_yet("inputPolicyOf"))
}
