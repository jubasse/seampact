//! The comparison of the request body of two operations: media, schema, limit, fields and proofs.

use seampact_diff_table::{DiffKind, DiffPosition, IrDefinition};
use seampact_ir::{InputField, InputProof, Operation, OperationInput};

use crate::DiffError;
use crate::change_sink::RawChange;
use crate::walk_context::{
    ChangeSite, KeyedListComparison, MemberComparisons, WalkContext, compare_keyed_list,
    compare_members, emit_at,
};
use crate::walk_json::{object_members, text_value};
use crate::walk_operations::operation_site_with_origin;
use crate::walk_type_use::{BoundSide, compare_bound, compare_type_use};

/// Compares the input bodies of two operations: added, removed, or member by member.
pub(crate) fn compare_body(
    context: &mut WalkContext<'_>,
    pointer: &str,
    operation: &Operation,
    before: Option<&OperationInput>,
    after: Option<&OperationInput>,
) -> Result<(), DiffError> {
    let (Some(before), Some(after)) = (before, after) else {
        let origin = after.or(before).map(|input| &input.origin);
        let operation_site = operation_site_with_origin(operation, DiffPosition::Input, origin);

        emit_at(
            context,
            &operation_site.site(),
            RawChange::new(
                DiffKind::Body,
                if after.is_none() { "removed" } else { "added" },
                pointer.to_owned(),
            ),
        );

        return Ok(());
    };
    let operation_site =
        operation_site_with_origin(operation, DiffPosition::Input, Some(&after.origin));
    let site = operation_site.site();
    let mut comparisons = MemberComparisons::new();

    // One media type per body: a change removes the old one, which a client still sends.
    comparisons.insert(
        "media",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            emit_at(
                context,
                &site,
                RawChange::new(DiffKind::Body, "mediaRemoved", member_pointer.to_owned()).between(
                    Some(text_value(before.media.as_str())),
                    Some(text_value(after.media.as_str())),
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
                &site,
                member_pointer,
                &before.schema,
                &after.schema,
            )
        }),
    );
    comparisons.insert(
        "bodyLimitBytes",
        Box::new(|context, member_pointer, before_value, after_value| {
            compare_bound(
                context,
                &site,
                member_pointer,
                BoundSide::Upper,
                before_value,
                after_value,
            )
        }),
    );
    comparisons.insert(
        "fields",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_input_fields(
                context,
                &site,
                member_pointer,
                before.fields.as_deref().unwrap_or_default(),
                after.fields.as_deref().unwrap_or_default(),
            )
        }),
    );
    comparisons.insert(
        "proofs",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_proofs(
                context,
                &site,
                member_pointer,
                before.proofs.as_deref().unwrap_or_default(),
                after.proofs.as_deref().unwrap_or_default(),
            )
        }),
    );

    compare_members(
        context,
        &site,
        IrDefinition::OperationInput,
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}

/// Compares the fields of two input bodies by name: a field added or removed follows its property.
fn compare_input_fields(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &[InputField],
    after: &[InputField],
) -> Result<(), DiffError> {
    let follows_property =
        |context: &mut WalkContext<'_>, entry_pointer: &str, field: &InputField| {
            emit_at(
                context,
                site,
                RawChange::new(DiffKind::Annotation, "fields", entry_pointer.to_owned())
                    .between(None, Some(text_value(&field.name))),
            );

            Ok(())
        };
    let comparison = KeyedListComparison {
        key_of: Box::new(|field: &InputField| Ok(field.name.clone())),
        added: Box::new(follows_property),
        removed: Box::new(follows_property),
        kept: Box::new(|context, entry_pointer, before_field, after_field| {
            compare_members(
                context,
                site,
                IrDefinition::InputField,
                entry_pointer,
                Some(&object_members(before_field)?),
                Some(&object_members(after_field)?),
                &MemberComparisons::new(),
            )
        }),
    };

    compare_keyed_list(context, pointer, before, after, &comparison)
}

/// Compares the proofs of two input bodies by name.
fn compare_proofs(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &[InputProof],
    after: &[InputProof],
) -> Result<(), DiffError> {
    let comparison = KeyedListComparison {
        key_of: Box::new(|proof: &InputProof| Ok(proof.name.clone())),
        added: Box::new(|context, entry_pointer, proof| {
            emit_at(
                context,
                site,
                RawChange::new(DiffKind::Proof, "added", entry_pointer.to_owned())
                    .between(None, Some(text_value(&proof.name))),
            );

            Ok(())
        }),
        removed: Box::new(|context, entry_pointer, proof| {
            emit_at(
                context,
                site,
                RawChange::new(DiffKind::Proof, "removed", entry_pointer.to_owned())
                    .between(Some(text_value(&proof.name)), None),
            );

            Ok(())
        }),
        kept: Box::new(|context, entry_pointer, before_proof, after_proof| {
            let mut comparisons = MemberComparisons::new();

            comparisons.insert(
                "schema",
                Box::new(|context, member_pointer, _before_value, _after_value| {
                    compare_type_use(
                        context,
                        site,
                        member_pointer,
                        &before_proof.schema,
                        &after_proof.schema,
                    )
                }),
            );

            compare_members(
                context,
                site,
                IrDefinition::InputProof,
                entry_pointer,
                Some(&object_members(before_proof)?),
                Some(&object_members(after_proof)?),
                &comparisons,
            )
        }),
    };

    compare_keyed_list(context, pointer, before, after, &comparison)
}
