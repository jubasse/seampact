//! The `fieldRights` of a route: one entry per restricted field its input and output reach.

use std::cmp::Ordering;

use indexmap::IndexMap;
use seampact_ir::{
    DerivationId, Direction, FieldRestriction, FieldRight, FieldRightSubject, InputPolicy,
};
use seampact_js::cmp_utf16;
use seampact_pipeline::{PassError, TreeNodeKind};

use crate::catalogues::AccessRightsCatalogues;
use crate::field_subjects::AccessRightsFieldRoute;
use crate::not_ported::not_ported_yet;
use crate::report::{AccessRightsProblem, AccessRightsReporter, AccessRightsRule};
use crate::restricted_fields::{
    AccessRightsDraftSchemas, AccessRightsFieldWalk, AccessRightsPositionWalk,
    AccessRightsRestrictedField, FIELD_RIGHTS_PER_OPERATION_LIMIT,
    access_rights_field_walk_exceeded, access_rights_restricted_fields,
};
use crate::restricted_positions::access_rights_refuse_route_positions;
use crate::restrictions::{AccessRightsCheckedRestriction, AccessRightsRestrictionChecks};
use crate::routes::access_rights_operation_of;
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

const FIELD_RIGHT_DERIVATION: DerivationId = DerivationId::from_static("fieldRight.restricted");

/// The `fieldRights` of a route: one entry per restricted field its input and responses reach.
///
/// # Errors
///
/// An internal error, or a [`PassError::NotPortedYet`] from a walk or a builder.
pub(crate) fn access_rights_field_rights(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    checks: &mut AccessRightsRestrictionChecks,
    input: &AccessRightsFieldRightsInput<'_>,
) -> Result<Vec<FieldRight>, PassError> {
    let route = &input.field_route.route;
    let node = context.nodes.get(route.node)?;

    if node.kind == TreeNodeKind::Relay {
        return Ok(Vec::new());
    }

    let operation = access_rights_operation_of(context, route)?;
    let mut reached: IndexMap<String, Vec<Reached<'_>>> = IndexMap::new();

    access_rights_refuse_route_positions(
        &mut AccessRightsPositionWalk {
            reporter: &mut *reporter,
            schemas: input.schemas,
            checks: &mut *checks,
        },
        route,
    )?;

    let mut walk = AccessRightsFieldWalk {
        reporter: &mut *reporter,
        schemas: input.schemas,
        checks: &mut *checks,
        route,
        reached: 0,
    };

    if let Some(declared) = &operation.input {
        access_rights_restricted_fields(
            &mut walk,
            &declared.schema,
            &mut adding_to(&mut reached, Direction::Input),
        )?;
    }

    for response in operation.responses.iter().flatten() {
        if let Some(body) = &response.body {
            access_rights_restricted_fields(
                &mut walk,
                body,
                &mut adding_to(&mut reached, Direction::Output),
            )?;
        }
    }

    if access_rights_field_walk_exceeded(&walk)? {
        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::FieldRightLimit,
            message: format!(
                "route '{}' reaches more than {FIELD_RIGHTS_PER_OPERATION_LIMIT} restricted fields from its input and responses, more field rights than one operation may list",
                route.id
            ),
            fix: "reference the schemas holding restricted fields from fewer places in this route's bodies".to_owned(),
            pointer: node.pointer.clone(),
            distinct_by: None,
            related: Vec::new(),
        });

        return Ok(Vec::new());
    }

    let mut located: Vec<Vec<Reached<'_>>> = reached.into_values().collect();

    located.sort_by(|left, right| by_location(left, right));

    let mut field_rights = Vec::new();

    for uses in &located {
        let mut entries = Vec::with_capacity(uses.len());

        for used in uses {
            entries.push(entry_of(
                context, reporter, catalogues, checks, input, used,
            )?);
        }

        let Some((Some(first), others)) = entries.split_first() else {
            continue;
        };

        if entries.iter().any(Option::is_none) {
            continue;
        }

        let mut conflicting = None;

        for (index, other) in others.iter().enumerate() {
            if !same_entry(Some(first), other.as_ref())? {
                conflicting = Some(index);

                break;
            }
        }

        if let Some(index) = conflicting {
            report_conflict(reporter, input, uses, index + 1)?;

            continue;
        }

        field_rights.push(first.clone());
    }

    Ok(field_rights)
}

// One key per schema, pointer and direction, as the TypeScript's `add` builds it.
fn adding_to<'reached, 'draft>(
    reached: &'reached mut IndexMap<String, Vec<Reached<'draft>>>,
    direction: Direction,
) -> impl FnMut(AccessRightsRestrictedField<'draft>) + 'reached {
    move |field| {
        let key = format!("{}\n{}\n{direction}", field.schema, field.pointer);

        reached.entry(key).or_default().push(Reached {
            field,
            direction: direction.clone(),
        });
    }
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

/// UTF-16 code unit order, as the TypeScript's `<` on strings.
pub(crate) fn compared(left: &str, right: &str) -> Ordering {
    cmp_utf16(left, right)
}

// Every use of one key shares its schema, pointer and direction, so the first one sorts the key.
pub(crate) fn by_location(left: &[Reached<'_>], right: &[Reached<'_>]) -> Ordering {
    let (Some(left_use), Some(right_use)) = (left.first(), right.first()) else {
        return Ordering::Equal;
    };

    compared(&left_use.field.schema, &right_use.field.schema)
        .then_with(|| compared(&left_use.field.pointer, &right_use.field.pointer))
        .then_with(|| {
            compared(
                &left_use.direction.to_string(),
                &right_use.direction.to_string(),
            )
        })
}

pub(crate) fn input_policy_of(
    _context: &AccessRightsContext,
    _restriction: &FieldRestriction,
) -> Result<InputPolicy, PassError> {
    Err(not_ported_yet("inputPolicyOf"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compared_orders_by_utf16_code_unit() {
        // U+1F600 is a surrogate pair (0xD83D..) in UTF-16, so it sorts before U+E000.
        assert_eq!(compared("\u{1F600}", "\u{E000}"), Ordering::Less);
        assert_eq!(compared("a", "b"), Ordering::Less);
        assert_eq!(compared("b", "b"), Ordering::Equal);
    }
}
