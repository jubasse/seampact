//! The comparison of the deprecation of two operations.

use std::cmp::Ordering;

use seampact_diff_table::{DiffKind, IrDefinition};
use seampact_ir::Deprecation;
use seampact_js::cmp_utf16;
use seampact_json::JsonValue;

use crate::DiffError;
use crate::change_sink::RawChange;
use crate::walk_context::{ChangeSite, MemberComparisons, WalkContext, compare_members, emit_at};
use crate::walk_json::{object_members, text_value};

fn successor_id(deprecation: &Deprecation) -> Option<JsonValue> {
    deprecation
        .successor
        .as_ref()
        .map(|successor| text_value(successor.id.as_str()))
}

fn emit_deprecation(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    deprecation_case: &str,
    pointer: &str,
    before: Option<JsonValue>,
    after: Option<JsonValue>,
) {
    emit_at(
        context,
        site,
        RawChange::new(DiffKind::Deprecation, deprecation_case, pointer.to_owned())
            .between(before, after),
    );
}

/// Compares the deprecations of two operations: added, removed, or member by member.
pub(crate) fn compare_deprecation(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: Option<&Deprecation>,
    after: Option<&Deprecation>,
) -> Result<(), DiffError> {
    let (Some(before), Some(after)) = (before, after) else {
        emit_deprecation(
            context,
            site,
            if after.is_none() { "removed" } else { "added" },
            pointer,
            before.map(|deprecation| text_value(&deprecation.sunset)),
            after.map(|deprecation| text_value(&deprecation.sunset)),
        );

        return Ok(());
    };
    let mut comparisons = MemberComparisons::new();

    comparisons.insert(
        "since",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            emit_deprecation(
                context,
                site,
                "sinceChanged",
                member_pointer,
                Some(text_value(&before.since)),
                Some(text_value(&after.since)),
            );

            Ok(())
        }),
    );
    // Calendar dates order as text.
    comparisons.insert(
        "sunset",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            let sunset_case = if cmp_utf16(&after.sunset, &before.sunset) == Ordering::Greater {
                "sunsetLater"
            } else {
                "sunsetEarlier"
            };

            emit_deprecation(
                context,
                site,
                sunset_case,
                member_pointer,
                Some(text_value(&before.sunset)),
                Some(text_value(&after.sunset)),
            );

            Ok(())
        }),
    );

    for member in ["successor", "successorRel"] {
        comparisons.insert(
            member,
            Box::new(|context, _member_pointer, _before_value, _after_value| {
                emit_deprecation(
                    context,
                    site,
                    "successorChanged",
                    pointer,
                    successor_id(before),
                    successor_id(after),
                );

                Ok(())
            }),
        );
    }

    compare_members(
        context,
        site,
        IrDefinition::Deprecation,
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}
