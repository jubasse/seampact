//! The comparison of type uses and of the enum values they share.

use seampact_diff_table::{DiffFact, DiffKind};
use seampact_ir::{KnownTypeUseRef, OutputEnumForm, TypeUse};
use seampact_json::JsonValue;

use crate::DiffError;
use crate::change_sink::RawChange;
use crate::not_ported::not_ported_yet;
use crate::walk_context::{
    ChangeSite, WalkContext, compare_kept_order, emit_at, refuse_unknown_value,
};
use crate::walk_json::{pointer_join, text_value};

/// Which end of a range a bound limits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BoundSide {
    Lower,
    Upper,
}

/// Compares one bound of two refinements.
///
/// # Errors
///
/// Not ported yet.
pub(crate) fn compare_bound(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _side: BoundSide,
    _before: Option<&JsonValue>,
    _after: Option<&JsonValue>,
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareBound"))
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
///
/// # Errors
///
/// Not ported yet.
fn compare_same_kind(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: KnownTypeUseRef<'_>,
    _after: KnownTypeUseRef<'_>,
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareSameKind"))
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
