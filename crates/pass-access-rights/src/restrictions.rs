//! A field restriction's right, checked once per right and params.

use std::collections::{HashMap, HashSet};

use seampact_ir::{FieldRestriction, Origin, Right};
use seampact_json::JsonValue;
use seampact_pipeline::PassError;

use crate::catalogues::AccessRightsCatalogues;
use crate::not_ported::not_ported_yet;
use crate::report::AccessRightsReporter;
use crate::schema_use::AccessRightsContext;

/// A restriction whose right exists and whose params fit.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AccessRightsCheckedRestriction {
    pub(crate) right: Right,
    pub(crate) params: Option<JsonValue>,
}

/// The restrictions checked so far, by key; `None` is a restriction refused with its error.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AccessRightsRestrictionChecks {
    pub(crate) checked: HashMap<String, Option<AccessRightsCheckedRestriction>>,
    pub(crate) recursive: HashSet<String>,
    pub(crate) reaching: HashSet<String>,
}

pub(crate) fn access_rights_restriction_checks(
    _reaching: HashSet<String>,
) -> Result<AccessRightsRestrictionChecks, PassError> {
    Err(not_ported_yet("accessRightsRestrictionChecks"))
}

pub(crate) fn access_rights_restriction_origin(
    _restriction: &FieldRestriction,
) -> Result<Origin, PassError> {
    Err(not_ported_yet("accessRightsRestrictionOrigin"))
}

pub(crate) fn access_rights_check_restriction(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _checks: &mut AccessRightsRestrictionChecks,
    _restriction: &FieldRestriction,
) -> Result<Option<AccessRightsCheckedRestriction>, PassError> {
    Err(not_ported_yet("accessRightsCheckRestriction"))
}

pub(crate) fn checked_restriction(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &AccessRightsCatalogues,
    _restriction: &FieldRestriction,
    _pointer: &str,
) -> Result<Option<AccessRightsCheckedRestriction>, PassError> {
    Err(not_ported_yet("checkedRestriction"))
}
