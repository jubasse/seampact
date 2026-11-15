//! The rights of each sort key of a route's paging (ADR 0002 section 9).

use indexmap::IndexMap;
use seampact_diagnostics::{InternalError, access_rights_quoted};
use seampact_ir::{
    DerivationId, DerivedFrom, FieldRestriction, FieldRightSubject, KnownSchemaRef,
    KnownTypeUseRef, ObjectSchema, OperationScope, SortKey,
};
use seampact_json::{JsonValue, canonical_json};
use seampact_pipeline::{DraftOperation, PassError, TreeNodeKind, json_at_pointer, pointer_below};

use crate::catalogues::AccessRightsCatalogues;
use crate::not_ported::not_ported_yet;
use crate::read::{access_rights_object, access_rights_string};
use crate::report::{
    AccessRightsProblem, AccessRightsRelated, AccessRightsReporter, AccessRightsRule,
};
use crate::restricted_fields::{AccessRightsDraftSchemas, schema_of};
use crate::restrictions::{AccessRightsRestrictionChecks, access_rights_restriction_origin};
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

const SORT_KEY_DERIVATION: DerivationId = DerivationId::from_static("sortKey.restricted");

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
    let Some(items) = item_objects_of(operation, input.schemas)? else {
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

/// The right a sort key derives: the one its entry writes, or the one its field is restricted to.
pub(crate) fn key_right(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    checks: &mut AccessRightsRestrictionChecks,
    use_of: &KeyUse<'_, '_>,
    sort_key: &SortKey,
) -> Result<Option<KeyRight>, PassError> {
    let restriction = key_restriction(reporter, use_of)?;
    let written = written_right(context, reporter, catalogues, sort_key);

    let (restriction, written) = match (restriction, written) {
        (KeyRestriction::Refused, _)
        | (_, WrittenRight::Refused)
        | (KeyRestriction::Absent, WrittenRight::Absent) => return Ok(None),
        (KeyRestriction::Absent, WrittenRight::Found { right, .. }) => {
            return Ok(Some(KeyRight {
                right,
                derived_from: None,
            }));
        }
        (KeyRestriction::Found(restriction), written) => (restriction, written),
    };
    let Some(inherited) =
        inherited_right(context, reporter, catalogues, checks, use_of, restriction)?
    else {
        return Ok(None);
    };

    if let WrittenRight::Found { right, pointer } = written
        && right != inherited.right
    {
        let quoted = access_rights_quoted(&inherited.right);

        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::SortKeyRight,
            message: format!(
                "sort key '{}' of route '{}' is given right '{}', but its field is restricted to '{quoted}'",
                access_rights_quoted(&use_of.key),
                use_of.route.id,
                access_rights_quoted(&right)
            ),
            fix: format!("remove the key's 'right', or write '{quoted}'"),
            pointer,
            distinct_by: None,
            related: vec![AccessRightsRelated {
                pointer: access_rights_restriction_origin(restriction)?.pointer,
                message: format!("the field is restricted to '{quoted}' here"),
            }],
        });

        return Ok(None);
    }

    Ok(Some(KeyRight {
        right: inherited.right,
        derived_from: Some(inherited.derived_from),
    }))
}

/// The item objects of a list: the body of its page or list response, a reference to an object or
/// to a union whose variants are all objects; `None` for any other item.
///
/// # Errors
///
/// An internal error for a reference to a schema `tree.schemas` did not write.
pub(crate) fn item_objects_of<'draft>(
    operation: &DraftOperation,
    schemas: &'draft AccessRightsDraftSchemas,
) -> Result<Option<Vec<&'draft ObjectSchema>>, InternalError> {
    let body = operation
        .responses
        .iter()
        .flatten()
        .find(|response| LIST_SHAPES.contains(&response.shape.as_str()))
        .and_then(|response| response.body.as_ref());
    let Some(body) = body else {
        return Ok(None);
    };
    let KnownTypeUseRef::Ref(reference) = KnownTypeUseRef::try_from(body)? else {
        return Ok(None);
    };
    let item = schema_of(schemas, reference.schema.as_str())?;

    match KnownSchemaRef::try_from(item)? {
        KnownSchemaRef::Object(object) => Ok(Some(vec![object])),
        KnownSchemaRef::Map(_) => Ok(None),
        KnownSchemaRef::Union(union) => {
            let mut objects = Vec::with_capacity(union.variants.len());

            for variant in &union.variants {
                let schema = schema_of(schemas, variant.schema.as_str())?;

                match KnownSchemaRef::try_from(schema)? {
                    KnownSchemaRef::Object(object) => objects.push(object),
                    KnownSchemaRef::Map(_) | KnownSchemaRef::Union(_) => return Ok(None),
                }
            }

            Ok(Some(objects))
        }
    }
}

// The canonical text of a restriction's params, `None` for absent ones, so equal params compare
// whatever their key order.
fn params_key_of(restriction: &FieldRestriction) -> Option<String> {
    restriction.params.as_ref().map(canonical_json)
}

/// The restriction of the key's field on every item object: none, the one they share, or refused
/// when they differ.
pub(crate) fn key_restriction<'draft>(
    reporter: &mut AccessRightsReporter,
    use_of: &KeyUse<'draft, '_>,
) -> Result<KeyRestriction<'draft>, PassError> {
    let restrictions: Vec<&'draft FieldRestriction> = use_of
        .items
        .iter()
        .copied()
        .filter_map(|item| {
            item.properties
                .iter()
                .find(|property| property.name == use_of.key)?
                .restricted_to
                .as_ref()
        })
        .collect();
    let Some((first, others)) = restrictions.split_first() else {
        return Ok(KeyRestriction::Absent);
    };
    let first_params = params_key_of(first);

    if others
        .iter()
        .all(|other| other.right == first.right && params_key_of(other) == first_params)
    {
        return Ok(KeyRestriction::Found(first));
    }

    let mut related = Vec::with_capacity(restrictions.len());

    for restriction in &restrictions {
        related.push(AccessRightsRelated {
            pointer: access_rights_restriction_origin(restriction)?.pointer,
            message: format!(
                "the field is restricted to '{}' here",
                access_rights_quoted(restriction.right.as_str())
            ),
        });
    }

    reporter.error(AccessRightsProblem {
        rule: AccessRightsRule::SortKeyRight,
        message: format!(
            "sort key '{}' of route '{}' sorts a union whose variants restrict its field differently, so the key has no one right",
            access_rights_quoted(&use_of.key),
            use_of.route.id
        ),
        fix: "give the field the same restrictedTo in every variant, or remove the key from 'sortable'"
            .to_owned(),
        pointer: use_of.pointer.clone(),
        distinct_by: None,
        related,
    });

    Ok(KeyRestriction::Refused)
}

/// The right a sortable entry writes (`{ key, right }`), checked against the rights catalogue; a
/// right with params is refused, since a sort key carries none.
pub(crate) fn written_right(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    sort_key: &SortKey,
) -> WrittenRight {
    let Some(origin) = &sort_key.origin else {
        return WrittenRight::Absent;
    };
    let merged = JsonValue::Object(context.context.raw.merged.clone());
    let entry = json_at_pointer(&merged, &origin.pointer);
    let Some(right) = access_rights_string(access_rights_object(entry), "right") else {
        return WrittenRight::Absent;
    };
    let pointer = pointer_below(&origin.pointer, &["right"]);
    let key = access_rights_quoted(&sort_key.key);
    let quoted = access_rights_quoted(right);

    match catalogues.rights.get(right) {
        Some(declared) if declared.params.is_none() => {
            return WrittenRight::Found {
                right: right.to_owned(),
                pointer,
            };
        }
        Some(_) => reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::SortKeyRight,
            message: format!(
                "sort key '{key}' is given right '{quoted}', which declares params, and a sort key's right carries no params"
            ),
            fix: "give the key a right without params, or remove its 'right'".to_owned(),
            pointer,
            distinct_by: None,
            related: Vec::new(),
        }),
        None if !catalogues.declared.rights.contains(right) => {
            reporter.error(AccessRightsProblem {
                rule: AccessRightsRule::SortKeyRight,
                message: format!(
                    "sort key '{key}' is given right '{quoted}', which the rights catalogue does not declare"
                ),
                fix: "declare the right in 'rights', or name a declared one".to_owned(),
                pointer,
                distinct_by: None,
                related: Vec::new(),
            });
        }
        None => {}
    }

    WrittenRight::Refused
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
