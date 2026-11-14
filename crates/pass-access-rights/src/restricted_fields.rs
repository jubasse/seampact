//! The fields of a schema graph a restriction reaches, and the positions that refuse them.

use std::collections::HashSet;

use seampact_ir::{FieldRestriction, IrMap, ObjectSchema, Property, Schema, SchemaId, TypeUse};
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;
use crate::report::AccessRightsReporter;
use crate::restrictions::AccessRightsRestrictionChecks;
use crate::routes::AccessRightsRoute;

pub(crate) type AccessRightsDraftSchemas = IrMap<SchemaId, Schema>;

/// The most restricted fields one operation reaches before its walk stops.
pub(crate) const FIELD_RIGHTS_PER_OPERATION_LIMIT: usize = 1000;

/// A restricted field found by a walk.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsRestrictedField<'draft> {
    pub(crate) schema: String,
    pub(crate) pointer: String,
    pub(crate) holder: &'draft ObjectSchema,
    pub(crate) property: &'draft Property,
    pub(crate) restriction: &'draft FieldRestriction,
}

/// One walk over the schemas an operation reaches; `reached` counts the fields found.
#[derive(Debug)]
pub(crate) struct AccessRightsFieldWalk<'draft, 'walk> {
    pub(crate) reporter: &'walk mut AccessRightsReporter,
    pub(crate) schemas: &'draft AccessRightsDraftSchemas,
    pub(crate) checks: &'walk mut AccessRightsRestrictionChecks,
    pub(crate) route: &'walk AccessRightsRoute,
    pub(crate) reached: usize,
}

/// What a refusal of restrictions below a position needs of a walk: the reporter, the schemas and
/// the checks.
#[derive(Debug)]
pub(crate) struct AccessRightsPositionWalk<'draft, 'walk> {
    pub(crate) reporter: &'walk mut AccessRightsReporter,
    pub(crate) schemas: &'draft AccessRightsDraftSchemas,
    pub(crate) checks: &'walk mut AccessRightsRestrictionChecks,
}

/// Where a walk is: the root schema, the pointer prefix, the schemas on the path.
#[derive(Debug, Clone)]
pub(crate) struct WalkAt {
    pub(crate) root: String,
    pub(crate) prefix: String,
    pub(crate) path: Vec<String>,
}

/// A position that refuses a restriction: its text and, when authored, its pointer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AccessRightsRefusedPosition {
    pub(crate) text: String,
    pub(crate) pointer: Option<String>,
}

pub(crate) fn access_rights_field_walk_exceeded(
    _walk: &AccessRightsFieldWalk<'_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("accessRightsFieldWalkExceeded"))
}

pub(crate) fn access_rights_restriction_reaching(
    _schemas: &AccessRightsDraftSchemas,
) -> Result<HashSet<String>, PassError> {
    Err(not_ported_yet("accessRightsRestrictionReaching"))
}

pub(crate) fn schema_references(_schema: &Schema) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("schemaReferences"))
}

pub(crate) fn use_references(_use: &TypeUse) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("useReferences"))
}

pub(crate) fn schema_of<'draft>(
    _schemas: &'draft AccessRightsDraftSchemas,
    _id: &str,
) -> Result<&'draft Schema, PassError> {
    Err(not_ported_yet("schemaOf"))
}

/// Calls `found` for each restricted field the use reaches.
pub(crate) fn access_rights_restricted_fields<'draft>(
    _walk: &mut AccessRightsFieldWalk<'draft, '_>,
    _use: &TypeUse,
    _found: &mut dyn FnMut(AccessRightsRestrictedField<'draft>),
) -> Result<(), PassError> {
    Err(not_ported_yet("accessRightsRestrictedFields"))
}

pub(crate) fn walk_schema<'draft>(
    _walk: &mut AccessRightsFieldWalk<'draft, '_>,
    _at: &WalkAt,
    _found: &mut dyn FnMut(AccessRightsRestrictedField<'draft>),
    _id: &str,
) -> Result<(), PassError> {
    Err(not_ported_yet("walkSchema"))
}

pub(crate) fn walk_use<'draft>(
    _walk: &mut AccessRightsFieldWalk<'draft, '_>,
    _at: &WalkAt,
    _found: &mut dyn FnMut(AccessRightsRestrictedField<'draft>),
    _use: &TypeUse,
) -> Result<(), PassError> {
    Err(not_ported_yet("walkUse"))
}

pub(crate) fn walk_reference<'draft>(
    _walk: &mut AccessRightsFieldWalk<'draft, '_>,
    _at: &WalkAt,
    _found: &mut dyn FnMut(AccessRightsRestrictedField<'draft>),
    _id: &str,
) -> Result<(), PassError> {
    Err(not_ported_yet("walkReference"))
}

pub(crate) fn access_rights_refuse_restrictions_below(
    _walk: &mut AccessRightsPositionWalk<'_, '_>,
    _use: &TypeUse,
    _position: &AccessRightsRefusedPosition,
) -> Result<(), PassError> {
    Err(not_ported_yet("accessRightsRefuseRestrictionsBelow"))
}

pub(crate) fn refuse_position(
    _reporter: &mut AccessRightsReporter,
    _holder: &str,
    _property: &Property,
    _restriction: &FieldRestriction,
    _position: &AccessRightsRefusedPosition,
) -> Result<(), PassError> {
    Err(not_ported_yet("refusePosition"))
}
