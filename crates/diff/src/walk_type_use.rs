//! The comparison of type uses and of the enum values they share.

use std::cmp::Ordering;

use seampact_diff_table::{DiffFact, DiffKind, DiffPosition, IrDefinition};
use seampact_ir::{
    ArrayTypeUse, DecimalLiteral, EnumTypeUse, FileTypeUse, JsonContent, KnownTypeUseRef,
    OutputEnumForm, Pattern, RefTypeUse, Refinements, ScalarTypeUse, SchemaId, TypeUse,
    UnknownKeys,
};
use seampact_json::{JsonValue, js_text_of};

use crate::DiffError;
use crate::change_sink::RawChange;
use crate::not_ported::not_ported_yet;
use crate::walk_context::{
    ChangeSite, MemberComparison, MemberComparisons, WalkContext, compare_kept_order,
    compare_members, emit_at, refuse_unknown_value,
};
use crate::walk_decimal::compare_decimals;
use crate::walk_json::{object_members, pointer_join, text_value};
use crate::walk_same_wire::is_same_wire_schema;

/// Which end of a range a bound limits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BoundSide {
    Lower,
    Upper,
}

/// Whether a refinement got tighter or looser.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RefinementCase {
    Tightened,
    Loosened,
}

impl RefinementCase {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Tightened => "tightened",
            Self::Loosened => "loosened",
        }
    }
}

/// A `tightened` or `loosened` refinement change.
fn emit_refinement(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    refinement_case: RefinementCase,
    before: Option<JsonValue>,
    after: Option<JsonValue>,
) {
    emit_at(
        context,
        site,
        RawChange::new(
            DiffKind::Refinement,
            refinement_case.as_str(),
            pointer.to_owned(),
        )
        .between(before, after),
    );
}

/// How a bound moved: a new bound tightens, a dropped one loosens, a moved one by its side.
fn bound_change(
    side: BoundSide,
    before: Option<&str>,
    after: Option<&str>,
) -> Result<Option<RefinementCase>, DiffError> {
    let (before, after) = match (before, after) {
        (None, None) => return Ok(None),
        (None, Some(_)) => return Ok(Some(RefinementCase::Tightened)),
        (Some(_), None) => return Ok(Some(RefinementCase::Loosened)),
        (Some(before), Some(after)) => (before, after),
    };
    let moved_up = match compare_decimals(after, before)? {
        Ordering::Equal => return Ok(None),
        Ordering::Greater => true,
        Ordering::Less => false,
    };

    Ok(Some(if moved_up == (side == BoundSide::Lower) {
        RefinementCase::Tightened
    } else {
        RefinementCase::Loosened
    }))
}

/// Compares one bound of two refinements; a number or a string is read as its JavaScript text.
pub(crate) fn compare_bound(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    bound_side: BoundSide,
    before: Option<&JsonValue>,
    after: Option<&JsonValue>,
) -> Result<(), DiffError> {
    let before_text = before.map(|value| js_text_of(Some(value)));
    let after_text = after.map(|value| js_text_of(Some(value)));
    let Some(refinement_case) =
        bound_change(bound_side, before_text.as_deref(), after_text.as_deref())?
    else {
        return Ok(());
    };

    emit_refinement(
        context,
        site,
        pointer,
        refinement_case,
        before.cloned(),
        after.cloned(),
    );

    Ok(())
}

/// Compares two type uses: an unknown kind is refused, another kind is a change of type, the same
/// kind is compared by its own members.
pub(crate) fn compare_type_use(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &TypeUse,
    after: &TypeUse,
) -> Result<(), DiffError> {
    let Ok(known_before) = KnownTypeUseRef::try_from(before) else {
        refuse_unknown_value(
            context,
            site,
            &pointer_join(pointer, &["kind"]),
            before.tag(),
        );

        return Ok(());
    };
    let Ok(known_after) = KnownTypeUseRef::try_from(after) else {
        refuse_unknown_value(
            context,
            site,
            &pointer_join(pointer, &["kind"]),
            after.tag(),
        );

        return Ok(());
    };

    if before.tag() != after.tag() {
        emit_at(
            context,
            site,
            RawChange::new(DiffKind::TypeChanged, "kind", pointer.to_owned()).between(
                Some(text_value(before.tag())),
                Some(text_value(after.tag())),
            ),
        );

        return Ok(());
    }

    compare_same_kind(context, site, pointer, known_before, known_after)
}

/// Compares two type uses of one kind by their members.
fn compare_same_kind(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: KnownTypeUseRef<'_>,
    after: KnownTypeUseRef<'_>,
) -> Result<(), DiffError> {
    match (before, after) {
        (KnownTypeUseRef::Ref(before_use), KnownTypeUseRef::Ref(after_use)) => {
            compare_ref_use(context, site, pointer, before_use, after_use)
        }
        (KnownTypeUseRef::Opaque(before_use), KnownTypeUseRef::Opaque(after_use)) => {
            compare_members(
                context,
                site,
                IrDefinition::OpaqueTypeUse,
                pointer,
                Some(&object_members(before_use)?),
                Some(&object_members(after_use)?),
                &nullable_comparisons(site),
            )
        }
        (KnownTypeUseRef::File(before_use), KnownTypeUseRef::File(after_use)) => {
            compare_file_use(context, site, pointer, before_use, after_use)
        }
        (KnownTypeUseRef::Enum(before_use), KnownTypeUseRef::Enum(after_use)) => {
            compare_enum_use(context, site, pointer, before_use, after_use)
        }
        (KnownTypeUseRef::Scalar(before_use), KnownTypeUseRef::Scalar(after_use)) => {
            compare_scalar_use(context, site, pointer, before_use, after_use)
        }
        (KnownTypeUseRef::Array(before_use), KnownTypeUseRef::Array(after_use)) => {
            compare_array_use(context, site, pointer, before_use, after_use)
        }
        // The kinds were checked equal by the caller: another pair has nothing to compare.
        (
            KnownTypeUseRef::Ref(_)
            | KnownTypeUseRef::Opaque(_)
            | KnownTypeUseRef::File(_)
            | KnownTypeUseRef::Enum(_)
            | KnownTypeUseRef::Scalar(_)
            | KnownTypeUseRef::Array(_),
            _,
        ) => Ok(()),
    }
}

/// The member comparisons every type use shares: its `nullable` flag.
fn nullable_comparisons<'comparison>(
    site: &'comparison ChangeSite<'_>,
) -> MemberComparisons<'comparison> {
    let mut comparisons = MemberComparisons::new();

    comparisons.insert(
        "nullable",
        Box::new(|context, pointer, before_value, after_value| {
            compare_nullable(context, site, pointer, before_value, after_value);

            Ok(())
        }),
    );

    comparisons
}

fn compare_ref_use(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &RefTypeUse,
    after: &RefTypeUse,
) -> Result<(), DiffError> {
    let mut comparisons = nullable_comparisons(site);

    comparisons.insert(
        "schema",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_schema_ref(
                context,
                site,
                member_pointer,
                Some(&before.schema),
                Some(&after.schema),
            )
        }),
    );
    comparisons.insert(
        "unknownKeys",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_unknown_keys(
                context,
                site,
                member_pointer,
                before.unknown_keys.as_ref(),
                after.unknown_keys.as_ref(),
            );

            Ok(())
        }),
    );

    compare_members(
        context,
        site,
        IrDefinition::RefTypeUse,
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}

/// The policy an absent `unknownKeys` stands for at a position.
const fn default_unknown_keys(position: DiffPosition) -> &'static str {
    match position {
        DiffPosition::Input | DiffPosition::None => "refuse",
        DiffPosition::Output => "ignore",
    }
}

/// The case of an `unknownKeys` change by the policy the use moves to.
fn unknown_keys_case(policy: &str) -> Option<&'static str> {
    match policy {
        "refuse" => Some("refused"),
        "ignore" => Some("ignored"),
        "keep" => Some("kept"),
        _ => None,
    }
}

/// Compares the unknown-key policy of two uses, once per reach: the default depends on the position.
fn compare_unknown_keys(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: Option<&UnknownKeys>,
    after: Option<&UnknownKeys>,
) {
    for reach in site.reaches {
        let reach_site = ChangeSite {
            reaches: std::slice::from_ref(reach),
            origin: site.origin.clone(),
        };
        let before_policy = before.map_or(default_unknown_keys(reach.position), |keys| {
            keys.policy.as_str()
        });
        let after_policy = after.map_or(default_unknown_keys(reach.position), |keys| {
            keys.policy.as_str()
        });

        if before_policy == after_policy {
            emit_at(
                context,
                &reach_site,
                RawChange::new(DiffKind::Annotation, "unknownKeys", pointer.to_owned()),
            );

            continue;
        }

        let Some(policy_case) = unknown_keys_case(after_policy) else {
            refuse_unknown_value(
                context,
                &reach_site,
                &pointer_join(pointer, &["policy"]),
                after_policy,
            );

            continue;
        };

        emit_at(
            context,
            &reach_site,
            RawChange::new(DiffKind::UnknownKeys, policy_case, pointer.to_owned()).between(
                Some(text_value(before_policy)),
                Some(text_value(after_policy)),
            ),
        );
    }
}

/// Compares the reference of a use or of a declaration to a schema: another wire is a change of
/// type, the same wire under another id a rename.
pub(crate) fn compare_schema_ref(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: Option<&SchemaId>,
    after: Option<&SchemaId>,
) -> Result<(), DiffError> {
    let same_wire = match (before, after) {
        (Some(before_id), Some(after_id)) => is_same_wire_schema(
            context.before,
            before_id.as_str(),
            context.after,
            after_id.as_str(),
        )?,
        _ => false,
    };
    let (kind, case_name) = if same_wire {
        (DiffKind::Name, "schema")
    } else {
        (DiffKind::TypeChanged, "ref")
    };

    emit_at(
        context,
        site,
        RawChange::new(kind, case_name, pointer.to_owned()).between(
            before.map(|id| text_value(id.as_str())),
            after.map(|id| text_value(id.as_str())),
        ),
    );

    Ok(())
}

fn compare_file_use(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &FileTypeUse,
    after: &FileTypeUse,
) -> Result<(), DiffError> {
    let mut comparisons = nullable_comparisons(site);

    comparisons.insert(
        "media",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            for media in before
                .media
                .iter()
                .filter(|kept| !after.media.contains(kept))
            {
                emit_refinement(
                    context,
                    site,
                    member_pointer,
                    RefinementCase::Tightened,
                    Some(text_value(media)),
                    None,
                );
            }

            for media in after
                .media
                .iter()
                .filter(|kept| !before.media.contains(kept))
            {
                emit_refinement(
                    context,
                    site,
                    member_pointer,
                    RefinementCase::Loosened,
                    None,
                    Some(text_value(media)),
                );
            }

            Ok(())
        }),
    );
    comparisons.insert(
        "maxSizeBytes",
        Box::new(|context, member_pointer, before_value, after_value| {
            compare_bound(
                context,
                site,
                member_pointer,
                BoundSide::Upper,
                before_value,
                after_value,
            )
        }),
    );

    compare_members(
        context,
        site,
        IrDefinition::FileTypeUse,
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}

fn compare_scalar_use(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &ScalarTypeUse,
    after: &ScalarTypeUse,
) -> Result<(), DiffError> {
    let mut comparisons = nullable_comparisons(site);

    comparisons.insert(
        "type",
        Box::new(|context, member_pointer, before_value, after_value| {
            emit_at(
                context,
                site,
                RawChange::new(
                    DiffKind::TypeChanged,
                    "scalarType",
                    member_pointer.to_owned(),
                )
                .between(before_value.cloned(), after_value.cloned()),
            );

            Ok(())
        }),
    );
    comparisons.insert(
        "format",
        Box::new(|context, member_pointer, before_value, after_value| {
            emit_at(
                context,
                site,
                RawChange::new(DiffKind::TypeChanged, "format", member_pointer.to_owned())
                    .between(before_value.cloned(), after_value.cloned()),
            );

            Ok(())
        }),
    );
    comparisons.insert(
        "refinements",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_refinements(
                context,
                site,
                member_pointer,
                &before.refinements,
                &after.refinements,
            )
        }),
    );
    comparisons.insert(
        "content",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_content(
                context,
                site,
                member_pointer,
                before.content.as_ref(),
                after.content.as_ref(),
            )
        }),
    );

    compare_members(
        context,
        site,
        IrDefinition::ScalarTypeUse,
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}

/// A refinement member as the text a bound compares: a number by its JavaScript text, a string as is.
fn numeric_text(value: Option<&JsonValue>) -> Option<JsonValue> {
    match value? {
        number @ JsonValue::Number(_) => Some(text_value(&js_text_of(Some(number)))),
        text @ JsonValue::String(_) => Some(text.clone()),
        JsonValue::Null | JsonValue::Bool(_) | JsonValue::Array(_) | JsonValue::Object(_) => None,
    }
}

fn bound_comparison<'comparison>(
    site: &'comparison ChangeSite<'_>,
    bound_side: BoundSide,
) -> MemberComparison<'comparison> {
    Box::new(move |context, member_pointer, before_value, after_value| {
        compare_bound(
            context,
            site,
            member_pointer,
            bound_side,
            numeric_text(before_value).as_ref(),
            numeric_text(after_value).as_ref(),
        )
    })
}

fn compare_refinements(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &Refinements,
    after: &Refinements,
) -> Result<(), DiffError> {
    let mut comparisons = MemberComparisons::new();

    for (member, bound_side) in [
        ("minLength", BoundSide::Lower),
        ("maxLength", BoundSide::Upper),
        ("minimum", BoundSide::Lower),
        ("maximum", BoundSide::Upper),
        ("exclusiveMinimum", BoundSide::Lower),
        ("exclusiveMaximum", BoundSide::Upper),
    ] {
        comparisons.insert(member, bound_comparison(site, bound_side));
    }

    comparisons.insert(
        "multipleOf",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_multiple_of(
                context,
                site,
                member_pointer,
                before.multiple_of.as_ref(),
                after.multiple_of.as_ref(),
            )
        }),
    );
    comparisons.insert(
        "pattern",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_pattern(
                context,
                site,
                member_pointer,
                before.pattern.as_ref(),
                after.pattern.as_ref(),
            )
        }),
    );

    compare_members(
        context,
        site,
        IrDefinition::Refinements,
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}

/// Compares the pattern of two refinements: a new one tightens, a dropped one loosens.
fn compare_pattern(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: Option<&Pattern>,
    after: Option<&Pattern>,
) -> Result<(), DiffError> {
    let (Some(before_pattern), Some(after_pattern)) = (before, after) else {
        emit_refinement(
            context,
            site,
            pointer,
            if before.is_none() {
                RefinementCase::Tightened
            } else {
                RefinementCase::Loosened
            },
            before.map(|pattern| text_value(&pattern.source)),
            after.map(|pattern| text_value(&pattern.source)),
        );

        return Ok(());
    };
    let mut comparisons = MemberComparisons::new();

    comparisons.insert(
        "normalized",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            emit_at(
                context,
                site,
                RawChange::new(
                    DiffKind::PatternChanged,
                    "changed",
                    member_pointer.to_owned(),
                )
                .between(
                    Some(text_value(&before_pattern.source)),
                    Some(text_value(&after_pattern.source)),
                ),
            );

            Ok(())
        }),
    );

    compare_members(
        context,
        site,
        IrDefinition::Pattern,
        pointer,
        Some(&object_members(before_pattern)?),
        Some(&object_members(after_pattern)?),
        &comparisons,
    )
}

/// Compares the enum values a use is narrowed to.
///
/// # Errors
///
/// Not ported yet.
fn compare_enum_use(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: &EnumTypeUse,
    _after: &EnumTypeUse,
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareEnumUse"))
}

/// Compares the item type and the length bounds of two array uses.
///
/// # Errors
///
/// Not ported yet.
fn compare_array_use(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: &ArrayTypeUse,
    _after: &ArrayTypeUse,
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareArrayUse"))
}

/// Compares the JSON content of two scalar uses.
///
/// # Errors
///
/// Not ported yet.
fn compare_content(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: Option<&JsonContent>,
    _after: Option<&JsonContent>,
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareContent"))
}

/// Compares the `multipleOf` of two refinements.
///
/// # Errors
///
/// Not ported yet.
fn compare_multiple_of(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: Option<&DecimalLiteral>,
    _after: Option<&DecimalLiteral>,
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareMultipleOf"))
}

/// A `nullable` change when the flag flipped; an absent flag means false.
pub(crate) fn compare_nullable(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: Option<&JsonValue>,
    after: Option<&JsonValue>,
) {
    let was_nullable = matches!(before, Some(JsonValue::Bool(true)));
    let is_nullable = matches!(after, Some(JsonValue::Bool(true)));

    if was_nullable == is_nullable {
        return;
    }

    emit_at(
        context,
        site,
        RawChange::new(
            DiffKind::Nullable,
            if is_nullable { "added" } else { "removed" },
            pointer.to_owned(),
        )
        .between(before.cloned(), after.cloned()),
    );
}

/// The facts an enum value change holds: output enums are open on both sides.
fn enum_value_facts(context: &WalkContext<'_>) -> Vec<DiffFact> {
    let open_in_both = context.before.api.wire.output_enums == OutputEnumForm::Open
        && context.after.api.wire.output_enums == OutputEnumForm::Open;

    if open_in_both {
        vec![DiffFact::OutputEnumsOpenInBoth]
    } else {
        Vec::new()
    }
}

/// Compares the values of two enums: added, removed, then the order of the values both keep.
pub(crate) fn compare_enum_values(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &[String],
    after: &[String],
) {
    let facts = enum_value_facts(context);

    for (index, value) in after.iter().enumerate() {
        if before.contains(value) {
            continue;
        }

        emit_at(
            context,
            site,
            RawChange::new(
                DiffKind::EnumValue,
                "added",
                pointer_join(pointer, &[&index.to_string()]),
            )
            .between(None, Some(text_value(value)))
            .with_facts(facts.clone()),
        );
    }

    for (index, value) in before.iter().enumerate() {
        if after.contains(value) {
            continue;
        }

        emit_at(
            context,
            site,
            RawChange::new(
                DiffKind::EnumValue,
                "removed",
                pointer_join(pointer, &[&index.to_string()]),
            )
            .between(Some(text_value(value)), None)
            .with_facts(facts.clone()),
        );
    }

    let before_names: Vec<&str> = before.iter().map(String::as_str).collect();
    let after_names: Vec<&str> = after.iter().map(String::as_str).collect();

    compare_kept_order(
        context,
        site,
        pointer,
        "values",
        &before_names,
        &after_names,
    );
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use seampact_json::JsonNumber;

    use super::*;
    use crate::change_sink::{ChangeSink, NO_POSITION};
    use crate::sample_ir::sample_ir;
    use crate::walk_reach::ReachIndex;

    fn number(value: f64) -> JsonValue {
        JsonValue::Number(
            JsonNumber::from_f64(value).unwrap_or_else(|| panic!("{value} is not finite")),
        )
    }

    fn bound_cases(
        side: BoundSide,
        before: Option<&JsonValue>,
        after: Option<&JsonValue>,
    ) -> Result<Vec<String>, DiffError> {
        let ir = sample_ir();
        let mut context = WalkContext {
            before: &ir,
            after: &ir,
            before_reach: ReachIndex::new(),
            after_reach: ReachIndex::new(),
            sink: ChangeSink::new(HashSet::new()),
        };
        let site = ChangeSite {
            reaches: &NO_POSITION,
            origin: None,
        };

        compare_bound(&mut context, &site, "/bound", side, before, after)?;

        Ok(context
            .sink
            .sorted_changes()
            .into_iter()
            .map(|change| change.case_name)
            .collect())
    }

    #[test]
    fn a_bound_moves_by_its_side_and_a_new_or_dropped_one_tightens_or_loosens() {
        let (low, high) = (number(5.0), number(7.0));

        for (side, before, after, expected) in [
            (BoundSide::Lower, Some(&low), Some(&high), "tightened"),
            (BoundSide::Lower, Some(&high), Some(&low), "loosened"),
            (BoundSide::Upper, Some(&low), Some(&high), "loosened"),
            (BoundSide::Upper, Some(&high), Some(&low), "tightened"),
            (BoundSide::Upper, None, Some(&low), "tightened"),
            (BoundSide::Upper, Some(&low), None, "loosened"),
        ] {
            assert_eq!(
                bound_cases(side, before, after).unwrap_or_else(|error| panic!("{error}")),
                vec![expected.to_owned()],
                "{side:?} {before:?} {after:?}"
            );
        }
    }

    #[test]
    fn a_bound_is_read_through_its_javascript_text() {
        let text = text_value("0.10");

        assert_eq!(
            bound_cases(BoundSide::Lower, Some(&number(0.1)), Some(&text)),
            Ok(Vec::new()),
            "0.1 and \"0.10\" are one value"
        );
        assert_eq!(
            bound_cases(BoundSide::Lower, Some(&number(-0.0)), Some(&number(0.0))),
            Ok(Vec::new()),
            "-0 reads as 0"
        );
        assert!(
            bound_cases(BoundSide::Upper, Some(&number(1e21)), Some(&number(1.0))).is_err(),
            "1e+21 is not a BigInt literal, which the TypeScript throws on"
        );
    }
}
