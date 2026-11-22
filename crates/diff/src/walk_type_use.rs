//! The comparison of type uses and of the enum values they share.

use std::cmp::Ordering;

use seampact_diff_table::{DiffFact, DiffKind, DiffPosition, IrDefinition};
use seampact_ir::{
    ArrayTypeUse, ContractIr, DecimalLiteral, EnumId, EnumNarrowing, EnumTypeUse, FileTypeUse,
    JsonContent, KnownTypeUseRef, OutputEnumForm, Pattern, RefTypeUse, Refinements, ScalarTypeUse,
    SchemaId, TypeUse, UnknownKeys,
};
use seampact_json::{JsonValue, js_text_of};

use crate::DiffError;
use crate::change_sink::RawChange;
use crate::walk_context::{
    ChangeSite, MemberComparison, MemberComparisons, WalkContext, compare_kept_order,
    compare_members, emit_at, refuse_unknown_value,
};
use crate::walk_decimal::{compare_decimals, is_decimal_multiple};
use crate::walk_json::{object_members, pointer_join, text_value};
use crate::walk_same_wire::{is_same_wire_enum, is_same_wire_schema};

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

/// Compares two enum uses: another enum is a rename on one wire, else a change of type. A narrowing
/// pins the values of the use, so they are compared here and not through the catalogue enum.
fn compare_enum_use(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &EnumTypeUse,
    after: &EnumTypeUse,
) -> Result<(), DiffError> {
    // Two enums of one wire carry the values of the use, so a narrowing still compares across the move.
    let same_wire_values = before.r#enum == after.r#enum
        || is_same_wire_enum(
            context.before,
            before.r#enum.as_str(),
            context.after,
            after.r#enum.as_str(),
        )?;
    let mut comparisons = nullable_comparisons(site);

    comparisons.insert(
        "enum",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            let (kind, case_name) = if same_wire_values {
                (DiffKind::Name, "enum")
            } else {
                (DiffKind::TypeChanged, "enum")
            };

            emit_at(
                context,
                site,
                RawChange::new(kind, case_name, member_pointer.to_owned()).between(
                    Some(text_value(before.r#enum.as_str())),
                    Some(text_value(after.r#enum.as_str())),
                ),
            );

            Ok(())
        }),
    );
    comparisons.insert(
        "narrowedTo",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            if !same_wire_values {
                return Ok(());
            }

            let (before_ir, after_ir) = (context.before, context.after);
            let before_values =
                narrowed_values(before.narrowed_to.as_ref(), before_ir, &before.r#enum);
            let after_values = narrowed_values(after.narrowed_to.as_ref(), after_ir, &after.r#enum);

            compare_enum_values(
                context,
                site,
                &pointer_join(member_pointer, &["values"]),
                before_values,
                after_values,
            );

            compare_narrowing_reason(
                context,
                site,
                member_pointer,
                before.narrowed_to.as_ref(),
                after.narrowed_to.as_ref(),
            )
        }),
    );

    compare_members(
        context,
        site,
        IrDefinition::EnumTypeUse,
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}

/// The values of an enum use: its narrowing's, else those of the catalogue enum, else none.
fn narrowed_values<'ir>(
    narrowing: Option<&'ir EnumNarrowing>,
    ir: &'ir ContractIr,
    enum_id: &EnumId,
) -> &'ir [String] {
    match narrowing {
        Some(narrowed) => &narrowed.values,
        None => ir
            .enums
            .get(enum_id.as_str())
            .map_or(&[], |catalogue_enum| &catalogue_enum.values),
    }
}

/// Compares the reason of two narrowings, when both have one; the values are compared apart.
fn compare_narrowing_reason(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: Option<&EnumNarrowing>,
    after: Option<&EnumNarrowing>,
) -> Result<(), DiffError> {
    let (Some(before_narrowing), Some(after_narrowing)) = (before, after) else {
        return Ok(());
    };
    let mut comparisons = MemberComparisons::new();

    comparisons.insert(
        "values",
        Box::new(|_context, _member_pointer, _before_value, _after_value| Ok(())),
    );

    compare_members(
        context,
        site,
        IrDefinition::EnumNarrowing,
        pointer,
        Some(&object_members(before_narrowing)?),
        Some(&object_members(after_narrowing)?),
        &comparisons,
    )
}

/// Compares the item type and the length bounds of two array uses.
fn compare_array_use(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &ArrayTypeUse,
    after: &ArrayTypeUse,
) -> Result<(), DiffError> {
    let mut comparisons = nullable_comparisons(site);

    comparisons.insert(
        "items",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_type_use(context, site, member_pointer, &before.items, &after.items)
        }),
    );
    comparisons.insert(
        "minItems",
        Box::new(|context, member_pointer, before_value, after_value| {
            compare_bound(
                context,
                site,
                member_pointer,
                BoundSide::Lower,
                before_value,
                after_value,
            )
        }),
    );
    comparisons.insert(
        "maxItems",
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
        IrDefinition::ArrayTypeUse,
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}

/// Compares the JSON content of two scalar uses: content on one side only is a change of type.
fn compare_content(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: Option<&JsonContent>,
    after: Option<&JsonContent>,
) -> Result<(), DiffError> {
    let (Some(before_content), Some(after_content)) = (before, after) else {
        emit_at(
            context,
            site,
            RawChange::new(DiffKind::TypeChanged, "content", pointer.to_owned()).between(
                before.map(|content| text_value(content.media.as_str())),
                after.map(|content| text_value(content.media.as_str())),
            ),
        );

        return Ok(());
    };
    let mut comparisons = MemberComparisons::new();

    comparisons.insert(
        "media",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            emit_at(
                context,
                site,
                RawChange::new(DiffKind::TypeChanged, "content", member_pointer.to_owned())
                    .between(
                        Some(text_value(before_content.media.as_str())),
                        Some(text_value(after_content.media.as_str())),
                    ),
            );

            Ok(())
        }),
    );
    comparisons.insert(
        "schema",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_type_use(
                context,
                site,
                member_pointer,
                &before_content.schema,
                &after_content.schema,
            )
        }),
    );

    compare_members(
        context,
        site,
        IrDefinition::JsonContent,
        pointer,
        Some(&object_members(before_content)?),
        Some(&object_members(after_content)?),
        &comparisons,
    )
}

/// Compares the `multipleOf` of two refinements: a new one tightens, a dropped one loosens, a moved
/// one tightens when it divides the old one and loosens when the old one divides it.
fn compare_multiple_of(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: Option<&DecimalLiteral>,
    after: Option<&DecimalLiteral>,
) -> Result<(), DiffError> {
    let (Some(before_multiple), Some(after_multiple)) = (before, after) else {
        emit_refinement(
            context,
            site,
            pointer,
            if before.is_none() {
                RefinementCase::Tightened
            } else {
                RefinementCase::Loosened
            },
            before.map(|multiple| text_value(multiple.as_str())),
            after.map(|multiple| text_value(multiple.as_str())),
        );

        return Ok(());
    };

    if compare_decimals(before_multiple.as_str(), after_multiple.as_str())? == Ordering::Equal {
        return Ok(());
    }

    let refinement_case = if is_decimal_multiple(after_multiple.as_str(), before_multiple.as_str())?
    {
        "tightened"
    } else if is_decimal_multiple(before_multiple.as_str(), after_multiple.as_str())? {
        "loosened"
    } else {
        "changed"
    };

    emit_at(
        context,
        site,
        RawChange::new(DiffKind::Refinement, refinement_case, pointer.to_owned()).between(
            Some(text_value(before_multiple.as_str())),
            Some(text_value(after_multiple.as_str())),
        ),
    );

    Ok(())
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
    use seampact_json::JsonNumber;

    use super::*;
    use crate::sample_ir::sample_ir;
    use crate::test_walk::{changes_of, ir_value};

    fn number(value: f64) -> JsonValue {
        JsonValue::Number(
            JsonNumber::from_f64(value).unwrap_or_else(|| panic!("{value} is not finite")),
        )
    }

    fn bound_cases(
        bound_side: BoundSide,
        before: Option<&JsonValue>,
        after: Option<&JsonValue>,
    ) -> Result<Vec<String>, DiffError> {
        let ir = sample_ir();

        changes_of(&ir, &ir, |context, site| {
            compare_bound(context, site, "/bound", bound_side, before, after)
        })
        .map(|changes| {
            changes
                .into_iter()
                .filter_map(|change| {
                    let (_, case) = change.split_once(':')?;

                    Some(case.split_once('@')?.0.to_owned())
                })
                .collect()
        })
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

    fn enum_ir(enums: &[(&str, &[&str])]) -> ContractIr {
        let mut ir = sample_ir();

        for (id, values) in enums {
            ir.enums.insert(
                EnumId::new((*id).to_owned()),
                ir_value(serde_json::json!({
                    "directions": ["output"],
                    "docs": {},
                    "id": id,
                    "localReason": "Local to this workspace.",
                    "name": {"role": "schema", "segments": [id.to_lowercase()]},
                    "origin": {"layer": "shared", "pointer": format!("/enums/{id}")},
                    "values": values,
                })),
            );
        }

        ir
    }

    fn enum_use(id: &str, narrowed_to: Option<&[&str]>) -> EnumTypeUse {
        match narrowed_to {
            Some(values) => {
                ir_value(serde_json::json!({"enum": id, "narrowedTo": {"values": values}}))
            }
            None => ir_value(serde_json::json!({"enum": id})),
        }
    }

    fn enum_use_changes(
        before_ir: &ContractIr,
        before: &EnumTypeUse,
        after_ir: &ContractIr,
        after: &EnumTypeUse,
    ) -> Vec<String> {
        changes_of(before_ir, after_ir, |context, site| {
            compare_enum_use(context, site, "/use", before, after)
        })
        .unwrap_or_else(|error| panic!("{error}"))
    }

    #[test]
    fn a_narrowing_of_one_enum_compares_its_values_and_a_missing_one_reads_the_catalogue() {
        let ir = enum_ir(&[("Color", &["red", "green"])]);

        assert_eq!(
            enum_use_changes(
                &ir,
                &enum_use("Color", Some(&["red"])),
                &ir,
                &enum_use("Color", Some(&["red", "green"])),
            ),
            vec!["EnumValue:added@/use/narrowedTo/values/1".to_owned()],
        );
        assert_eq!(
            enum_use_changes(
                &ir,
                &enum_use("Color", None),
                &ir,
                &enum_use("Color", Some(&["red"])),
            ),
            vec!["EnumValue:removed@/use/narrowedTo/values/1".to_owned()],
            "no narrowing reads the values of the catalogue enum"
        );
    }

    #[test]
    fn a_move_to_an_enum_of_one_wire_is_a_name_and_any_other_a_type_change() {
        let ir = enum_ir(&[
            ("Color", &["red", "green"]),
            ("Hue", &["red", "green"]),
            ("Size", &["small", "large"]),
        ]);

        assert_eq!(
            enum_use_changes(&ir, &enum_use("Color", None), &ir, &enum_use("Hue", None)),
            vec!["Name:enum@/use/enum".to_owned()],
        );
        assert_eq!(
            enum_use_changes(
                &ir,
                &enum_use("Color", Some(&["red"])),
                &ir,
                &enum_use("Hue", Some(&["green"])),
            ),
            vec![
                "Name:enum@/use/enum".to_owned(),
                "EnumValue:added@/use/narrowedTo/values/0".to_owned(),
                "EnumValue:removed@/use/narrowedTo/values/0".to_owned()
            ],
            "the narrowing compares across the move"
        );
        assert_eq!(
            enum_use_changes(&ir, &enum_use("Color", None), &ir, &enum_use("Size", None)),
            vec!["TypeChanged:enum@/use/enum".to_owned()],
        );
        assert_eq!(
            enum_use_changes(
                &ir,
                &enum_use("Color", Some(&["red"])),
                &ir,
                &enum_use("Size", Some(&["small"])),
            ),
            vec!["TypeChanged:enum@/use/enum".to_owned()],
            "another wire leaves the narrowing alone"
        );
    }

    fn multiple_of_changes(before: Option<&str>, after: Option<&str>) -> Vec<String> {
        let ir = sample_ir();
        let (before, after) = (
            before.map(|text| DecimalLiteral::new(text.to_owned())),
            after.map(|text| DecimalLiteral::new(text.to_owned())),
        );

        changes_of(&ir, &ir, |context, site| {
            compare_multiple_of(
                context,
                site,
                "/multipleOf",
                before.as_ref(),
                after.as_ref(),
            )
        })
        .unwrap_or_else(|error| panic!("{error}"))
    }

    #[test]
    fn a_multiple_tightens_when_it_divides_the_old_one_and_loosens_when_the_old_one_divides_it() {
        for (before, after, expected) in [
            (None, Some("2"), Some("tightened")),
            (Some("2"), None, Some("loosened")),
            (Some("1"), Some("2"), Some("tightened")),
            (Some("0.5"), Some("1.5"), Some("tightened")),
            (Some("2"), Some("1"), Some("loosened")),
            (Some("0.3"), Some("0.2"), Some("changed")),
            (Some("1.50"), Some("1.5"), None),
            (Some("0"), Some("3"), Some("loosened")),
            (Some("3"), Some("0"), Some("tightened")),
        ] {
            assert_eq!(
                multiple_of_changes(before, after),
                expected
                    .map(|case| format!("Refinement:{case}@/multipleOf"))
                    .into_iter()
                    .collect::<Vec<_>>(),
                "{before:?} -> {after:?}"
            );
        }
    }

    fn string_use() -> serde_json::Value {
        serde_json::json!({"kind": "scalar", "type": "string", "refinements": {}})
    }

    fn array_use(items: &serde_json::Value, min: Option<i64>, max: Option<i64>) -> ArrayTypeUse {
        let mut json = serde_json::json!({"kind": "array", "items": items});

        if let Some(members) = json.as_object_mut() {
            for (name, bound) in [("minItems", min), ("maxItems", max)] {
                if let Some(bound) = bound {
                    members.insert(name.to_owned(), serde_json::json!(bound));
                }
            }
        }

        ir_value(json)
    }

    #[test]
    fn an_array_compares_its_item_type_and_its_length_bounds() {
        let ir = sample_ir();
        let integer = serde_json::json!({"kind": "scalar", "type": "int32", "refinements": {}});
        let (before, after) = (
            array_use(&string_use(), Some(1), Some(5)),
            array_use(&integer, Some(2), Some(9)),
        );

        assert_eq!(
            changes_of(&ir, &ir, |context, site| {
                compare_array_use(context, site, "/array", &before, &after)
            })
            .unwrap_or_else(|error| panic!("{error}")),
            vec![
                "TypeChanged:scalarType@/array/items/type".to_owned(),
                "Refinement:loosened@/array/maxItems".to_owned(),
                "Refinement:tightened@/array/minItems".to_owned(),
            ],
        );
    }

    fn json_content(media: &str, schema: &serde_json::Value) -> JsonContent {
        ir_value(serde_json::json!({"media": media, "schema": schema}))
    }

    fn content_changes(before: Option<&JsonContent>, after: Option<&JsonContent>) -> Vec<String> {
        let ir = sample_ir();

        changes_of(&ir, &ir, |context, site| {
            compare_content(context, site, "/content", before, after)
        })
        .unwrap_or_else(|error| panic!("{error}"))
    }

    #[test]
    fn content_on_one_side_only_or_with_another_media_is_a_type_change() {
        let json = json_content("application/json", &string_use());
        let problem = json_content("application/problem+json", &string_use());
        let integer = serde_json::json!({"kind": "scalar", "type": "int32", "refinements": {}});

        assert_eq!(
            content_changes(None, Some(&json)),
            vec!["TypeChanged:content@/content".to_owned()],
        );
        assert_eq!(
            content_changes(Some(&json), Some(&problem)),
            vec!["TypeChanged:content@/content/media".to_owned()],
        );
        assert_eq!(
            content_changes(
                Some(&json),
                Some(&json_content("application/json", &integer))
            ),
            vec!["TypeChanged:scalarType@/content/schema/type".to_owned()],
        );
    }
}
