//! The `fieldRights` of a route: one entry per restricted field its input and output reach.

use std::cmp::Ordering;

use indexmap::IndexMap;
use seampact_diagnostics::{InternalError, access_rights_quoted};
use seampact_ir::{
    DerivationId, DerivedFrom, Direction, FieldRestriction, FieldRight, FieldRightSubject,
    InputPolicy, SchemaId,
};
use seampact_js::cmp_utf16;
use seampact_json::{JsonValue, canonical_json, stringify_json};
use seampact_pipeline::{PassError, TreeNodeKind};

use crate::catalogues::AccessRightsCatalogues;
use crate::field_subjects::{
    AccessRightsFieldRoute, access_rights_field_text, access_rights_input_subject,
    access_rights_output_subject,
};
use crate::report::{
    AccessRightsProblem, AccessRightsRelated, AccessRightsReporter, AccessRightsRule,
};
use crate::restricted_fields::{
    AccessRightsDraftSchemas, AccessRightsFieldWalk, AccessRightsPositionWalk,
    AccessRightsRestrictedField, FIELD_RIGHTS_PER_OPERATION_LIMIT,
    access_rights_field_walk_exceeded, access_rights_restricted_fields,
};
use crate::restricted_positions::access_rights_refuse_route_positions;
use crate::restrictions::{
    AccessRightsCheckedRestriction, AccessRightsRestrictionChecks, access_rights_check_restriction,
    access_rights_restriction_origin,
};
use crate::routes::access_rights_operation_of;
use crate::schema_use::AccessRightsContext;
use crate::subjects::AccessRightsSubjectResult;

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
/// An internal error.
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
        context,
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

    if access_rights_field_walk_exceeded(&walk) {
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
            if !same_entry(Some(first), other.as_ref()) {
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
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    checks: &mut AccessRightsRestrictionChecks,
    input: &AccessRightsFieldRightsInput<'_>,
    reached: &Reached<'_>,
) -> Result<Option<FieldRight>, PassError> {
    let Reached { field, direction } = reached;
    let Some(checked) =
        access_rights_check_restriction(context, reporter, catalogues, checks, field.restriction)?
    else {
        return Ok(None);
    };
    let subject = match direction {
        Direction::Input => access_rights_input_subject(
            context,
            reporter,
            catalogues,
            &input.field_route,
            field,
            &checked.right,
        )?,
        Direction::Output => access_rights_output_subject(
            context,
            reporter,
            catalogues,
            &input.field_route,
            field,
            &checked.right,
        )?,
        Direction::Unknown(_) => {
            return Err(InternalError::new(format!(
                "a restricted field was reached in direction '{direction}', which is neither input nor output"
            ))
            .into());
        }
    };
    let AccessRightsSubjectResult::Resolved { subject } = subject else {
        return Ok(None);
    };

    Ok(Some(field_right_of(
        context,
        field,
        direction,
        &checked,
        subject.as_ref(),
    )?))
}

// Two entries at one pointer agree when they differ by their derivation only. Params compare by
// canonical text, so the key order of an object does not matter.
pub(crate) fn same_entry(left: Option<&FieldRight>, right: Option<&FieldRight>) -> bool {
    let (Some(left), Some(right)) = (left, right) else {
        return false;
    };
    let canonical_params = |entry: &FieldRight| entry.params.as_ref().map(canonical_json);
    let without_derivation = |entry: &FieldRight| FieldRight {
        derived_from: DerivedFrom {
            derivation: FIELD_RIGHT_DERIVATION,
            from: Vec::new(),
        },
        params: None,
        ..entry.clone()
    };

    canonical_params(left) == canonical_params(right)
        && without_derivation(left) == without_derivation(right)
}

pub(crate) fn report_conflict(
    reporter: &mut AccessRightsReporter,
    input: &AccessRightsFieldRightsInput<'_>,
    uses: &[Reached<'_>],
    conflicting: usize,
) -> Result<(), InternalError> {
    let route = &input.field_route.route;
    let (Some(first), Some(second)) = (uses.first(), uses.get(conflicting)) else {
        return Err(InternalError::new(format!(
            "no conflicting field at index {conflicting} of route '{}'",
            route.id
        )));
    };
    let holder_text =
        |field: &AccessRightsRestrictedField<'_>| access_rights_quoted(field.holder.id.as_str());

    reporter.error(AccessRightsProblem {
        rule: AccessRightsRule::FieldRightConflict,
        message: format!(
            "{} field '{}' of route '{}' is restricted in '{}' and in '{}' with a different right, params, input policy or subject, and one field right cannot hold both",
            second.direction,
            access_rights_field_text(&second.field),
            route.id,
            holder_text(&first.field),
            holder_text(&second.field)
        ),
        fix: "give the fields at this pointer the same restrictedTo and subject, or rename one of them".to_owned(),
        pointer: access_rights_restriction_origin(second.field.restriction)?.pointer.clone(),
        distinct_by: None,
        related: vec![AccessRightsRelated {
            pointer: access_rights_restriction_origin(first.field.restriction)?.pointer.clone(),
            message: format!("the field of '{}' is restricted here", holder_text(&first.field)),
        }],
    });

    Ok(())
}

pub(crate) fn field_right_of(
    context: &AccessRightsContext,
    field: &AccessRightsRestrictedField<'_>,
    direction: &Direction,
    checked: &AccessRightsCheckedRestriction,
    subject: Option<&FieldRightSubject>,
) -> Result<FieldRight, InternalError> {
    let input_policy = match direction {
        Direction::Input => Some(input_policy_of(context, field.restriction)?),
        Direction::Output | Direction::Unknown(_) => None,
    };

    Ok(FieldRight {
        schema: SchemaId::new(field.schema.clone()),
        pointer: field.pointer.clone(),
        right: checked.right.id.clone(),
        params: checked.params.clone(),
        subject: subject.cloned(),
        direction: direction.clone(),
        input_policy,
        always: None,
        derived_from: DerivedFrom {
            derivation: FIELD_RIGHT_DERIVATION,
            from: vec![access_rights_restriction_origin(field.restriction)?.clone()],
        },
    })
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

// The field's own `input`, else `conventions.restrictedInput` (reject by default, A21).
pub(crate) fn input_policy_of(
    context: &AccessRightsContext,
    restriction: &FieldRestriction,
) -> Result<InputPolicy, InternalError> {
    if let Some(policy) = &restriction.input_policy {
        return Ok(policy.clone());
    }

    let convention = context.context.conventions.get("restrictedInput")?;

    match convention.as_ref().map(|reading| reading.value) {
        Some(JsonValue::String(text)) if text == "reject" => Ok(InputPolicy::Reject),
        Some(JsonValue::String(text)) if text == "strip" => Ok(InputPolicy::Strip),
        other => Err(InternalError::new(format!(
            "conventions.restrictedInput resolves to no policy: {}",
            other.map_or_else(|| "undefined".to_owned(), stringify_json)
        ))),
    }
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
