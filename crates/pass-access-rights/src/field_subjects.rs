//! The subject of a field right: the id of the resource it checks, or its scope.

use seampact_ir::{FieldRightSubject, OperationScope, ResourceSubject, Right};
use seampact_pipeline::PassError;

use crate::catalogues::AccessRightsCatalogues;
use crate::not_ported::not_ported_yet;
use crate::report::{AccessRightsRelated, AccessRightsReporter};
use crate::restricted_fields::AccessRightsRestrictedField;
use crate::routes::AccessRightsRoute;
use crate::schema_use::AccessRightsContext;
use crate::subjects::{AccessRightsSourceSchema, AccessRightsSubjectResult};

/// A route with the scopes it enters.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsFieldRoute {
    pub(crate) route: AccessRightsRoute,
    pub(crate) scopes: Vec<OperationScope>,
}

/// One restricted field's scope use, with the pointer it is written at.
#[derive(Debug, Clone)]
pub(crate) struct FieldScopeUse<'draft, 'route> {
    pub(crate) field_route: &'route AccessRightsFieldRoute,
    pub(crate) field: &'route AccessRightsRestrictedField<'draft>,
    pub(crate) right: &'route Right,
    pub(crate) pointer: String,
}

pub(crate) fn access_rights_field_text(
    _field: &AccessRightsRestrictedField<'_>,
) -> Result<String, PassError> {
    Err(not_ported_yet("accessRightsFieldText"))
}

pub(crate) fn restricted_here(
    _field: &AccessRightsRestrictedField<'_>,
) -> Result<Vec<AccessRightsRelated>, PassError> {
    Err(not_ported_yet("restrictedHere"))
}

pub(crate) fn access_rights_id_schema_of(
    _catalogues: &AccessRightsCatalogues,
    _right: &Right,
    _subject: &ResourceSubject,
) -> Result<AccessRightsSourceSchema, PassError> {
    Err(not_ported_yet("accessRightsIdSchemaOf"))
}

pub(crate) fn access_rights_input_subject(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _field_route: &AccessRightsFieldRoute,
    _field: &AccessRightsRestrictedField<'_>,
    _right: &Right,
) -> Result<AccessRightsSubjectResult<FieldRightSubject>, PassError> {
    Err(not_ported_yet("accessRightsInputSubject"))
}

pub(crate) fn scope_subject(
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _use: &FieldScopeUse<'_, '_>,
    _scope: &str,
) -> Result<AccessRightsSubjectResult<FieldRightSubject>, PassError> {
    Err(not_ported_yet("scopeSubject"))
}

pub(crate) fn access_rights_output_subject(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _field_route: &AccessRightsFieldRoute,
    _field: &AccessRightsRestrictedField<'_>,
    _right: &Right,
) -> Result<AccessRightsSubjectResult<FieldRightSubject>, PassError> {
    Err(not_ported_yet("accessRightsOutputSubject"))
}
