//! The rights of each sort key of a route's paging (ADR 0002 section 9).

use indexmap::IndexMap;
use seampact_ir::{
    DerivedFrom, FieldRestriction, FieldRightSubject, ObjectSchema, OperationScope, SortKey,
};
use seampact_diagnostics::access_rights_quoted;
use seampact_pipeline::{PassError, TreeNodeKind};

use crate::catalogues::AccessRightsCatalogues;
use crate::not_ported::not_ported_yet;
use crate::report::{AccessRightsProblem, AccessRightsReporter, AccessRightsRule};
use crate::restricted_fields::AccessRightsDraftSchemas;
use crate::restrictions::AccessRightsRestrictionChecks;
use crate::routes::{AccessRightsRoute, access_rights_operation_of};
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

/// The right and subject of each sort key that names a restricted field, by the key's position.
///
/// # Errors
///
/// An internal error, or a [`PassError::NotPortedYet`] from a key reader.
pub(crate) fn access_rights_sort_key_rights(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    checks: &mut AccessRightsRestrictionChecks,
    input: &AccessRightsSortKeysInput<'_>,
) -> Result<AccessRightsSortKeyRights, PassError> {
    let mut rights = IndexMap::new();
    let route = &input.route;
    let node = context.nodes.get(route.node)?;
    let operation = access_rights_operation_of(context, route)?;
    let Some(paging) = &operation.paging else {
        return Ok(rights);
    };

    if node.kind == TreeNodeKind::Relay {
        return Ok(rights);
    }

    let key_pointer = |sort_key: &SortKey| {
        sort_key
            .origin
            .as_ref()
            .map_or_else(|| node.pointer.clone(), |origin| origin.pointer.clone())
    };
    let Some(items) = item_objects_of(route, input.schemas)? else {
        for sort_key in &paging.sort_keys {
            reporter.error(AccessRightsProblem {
                rule: AccessRightsRule::SortKeyRight,
                message: format!(
                    "sort key '{}' of route '{}' sorts a list whose item is neither an object nor a union of objects, so its field's restriction cannot be read",
                    access_rights_quoted(&sort_key.key),
                    route.id
                ),
                fix: "remove the key from 'sortable', or list an object schema".to_owned(),
                pointer: key_pointer(sort_key),
                distinct_by: None,
                related: Vec::new(),
            });
        }

        return Ok(rights);
    };

    for (index, sort_key) in paging.sort_keys.iter().enumerate() {
        let key_use = KeyUse {
            route,
            scopes: &input.scopes,
            items: items.clone(),
            key: sort_key.key.clone(),
            pointer: key_pointer(sort_key),
        };
        let Some(right) = key_right(context, reporter, catalogues, checks, &key_use, sort_key)?
        else {
            continue;
        };
        let found = key_subject(context, reporter, catalogues, &key_use, &right.right)?;
        let AccessRightsSubjectResult::Resolved { subject } = found else {
            continue;
        };

        rights.insert(
            index,
            AccessRightsSortKeyRight {
                right: right.right,
                subject,
                derived_from: right.derived_from,
            },
        );
    }

    Ok(rights)
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
