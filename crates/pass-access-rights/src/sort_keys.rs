//! The rights of each sort key of a route's paging (ADR 0002 section 9).

use indexmap::IndexMap;
use seampact_ir::{
    DerivedFrom, FieldRestriction, FieldRightSubject, ObjectSchema, OperationScope, SortKey,
};
use seampact_pipeline::PassError;

use crate::catalogues::AccessRightsCatalogues;
use crate::not_ported::not_ported_yet;
use crate::report::AccessRightsReporter;
use crate::restricted_fields::AccessRightsDraftSchemas;
use crate::restrictions::AccessRightsRestrictionChecks;
use crate::routes::AccessRightsRoute;
use crate::schema_use::AccessRightsContext;
use crate::subjects::AccessRightsSubjectResult;

/// The right of one sort key, with its subject and what it derives from.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AccessRightsSortKeyRight {
    pub(crate) right: String,
    pub(crate) subject: Option<FieldRightSubject>,
    pub(crate) derived_from: Option<DerivedFrom>,
}

/// The rights of the sort keys that have one, by the key's position in the paging.
pub(crate) type AccessRightsSortKeyRights = IndexMap<usize, AccessRightsSortKeyRight>;

#[derive(Debug, Clone)]
pub(crate) struct AccessRightsSortKeysInput<'draft> {
    pub(crate) route: AccessRightsRoute,
    pub(crate) scopes: Vec<OperationScope>,
    pub(crate) schemas: &'draft AccessRightsDraftSchemas,
}

/// One sort key use: the item schemas it reads, its key text and the pointer it is written at.
#[derive(Debug, Clone)]
pub(crate) struct KeyUse<'draft, 'route> {
    pub(crate) route: &'route AccessRightsRoute,
    pub(crate) scopes: &'route [OperationScope],
    pub(crate) items: Vec<&'draft ObjectSchema>,
    pub(crate) key: String,
    pub(crate) pointer: String,
}

/// The right a sort key derives, with what it derives from.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct KeyRight {
    pub(crate) right: String,
    pub(crate) derived_from: Option<DerivedFrom>,
}

/// A right inherited from the field restriction a key names.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct InheritedRight {
    pub(crate) right: String,
    pub(crate) derived_from: DerivedFrom,
}

/// What `keyRestriction` finds: a restriction, an error already reported, or none.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum KeyRestriction<'draft> {
    Found(&'draft FieldRestriction),
    Refused,
    Absent,
}

/// What `writtenRight` finds: the right the author wrote, an error already reported, or none.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum WrittenRight {
    Found { right: String, pointer: String },
    Refused,
    Absent,
}

const LIST_SHAPES: &[&str] = &["page", "list"];

pub(crate) fn access_rights_sort_key_rights(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _checks: &mut AccessRightsRestrictionChecks,
    _input: &AccessRightsSortKeysInput<'_>,
) -> Result<AccessRightsSortKeyRights, PassError> {
    Err(not_ported_yet("accessRightsSortKeyRights"))
}

pub(crate) fn key_right(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _checks: &mut AccessRightsRestrictionChecks,
    _use: &KeyUse<'_, '_>,
    _sort_key: &SortKey,
) -> Result<Option<KeyRight>, PassError> {
    Err(not_ported_yet("keyRight"))
}

pub(crate) fn item_objects_of<'draft>(
    _route: &AccessRightsRoute,
    _schemas: &'draft AccessRightsDraftSchemas,
) -> Result<Option<Vec<&'draft ObjectSchema>>, PassError> {
    Err(not_ported_yet("itemObjectsOf"))
}

pub(crate) fn key_restriction<'draft>(
    _reporter: &mut AccessRightsReporter,
    _use: &KeyUse<'draft, '_>,
) -> Result<KeyRestriction<'draft>, PassError> {
    Err(not_ported_yet("keyRestriction"))
}

pub(crate) fn written_right(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _sort_key: &SortKey,
) -> Result<WrittenRight, PassError> {
    Err(not_ported_yet("writtenRight"))
}

pub(crate) fn inherited_right(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _checks: &mut AccessRightsRestrictionChecks,
    _use: &KeyUse<'_, '_>,
    _restriction: &FieldRestriction,
) -> Result<Option<InheritedRight>, PassError> {
    Err(not_ported_yet("inheritedRight"))
}

pub(crate) fn key_subject(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _use: &KeyUse<'_, '_>,
    _right_id: &str,
) -> Result<AccessRightsSubjectResult<FieldRightSubject>, PassError> {
    Err(not_ported_yet("keySubject"))
}
