//! The comparison of the operations of the two IRs.

use std::collections::HashMap;

use seampact_diff_table::{DiffKind, DiffPosition, IrDefinition};
use seampact_ir::{DeclarationKind, Operation, OperationMaturity, Origin};
use seampact_json::{JsonValue, pointer_below};

use crate::DiffError;
use crate::change_sink::{ChangeReach, ElementOrigin, RawChange};
use crate::walk_access::access_comparisons;
use crate::walk_behaviour::behaviour_comparisons;
use crate::walk_body::compare_body;
use crate::walk_context::{
    ChangeSite, MemberComparisons, WalkContext, compare_members, emit_at, refuse_unknown_value,
};
use crate::walk_deprecation::compare_deprecation;
use crate::walk_json::{object_members, text_value};
use crate::walk_maturity::compare_maturity_level;
use crate::walk_params::compare_params;
use crate::walk_responses::compare_responses;

/// The reaches and the origin of one operation's changes, owned so a comparison can keep them.
#[derive(Debug, Clone)]
pub(crate) struct OperationSite {
    reaches: Vec<ChangeReach>,
    origin: Option<ElementOrigin>,
}

impl OperationSite {
    /// The site to emit at.
    pub(crate) fn site(&self) -> ChangeSite<'_> {
        ChangeSite {
            reaches: &self.reaches,
            origin: self.origin.clone(),
        }
    }
}

/// Compares the operations both IRs hold by id: added, removed, or compared member by member.
pub(crate) fn compare_operations(context: &mut WalkContext<'_>) -> Result<(), DiffError> {
    let (before_ir, after_ir) = (context.before, context.after);
    let before_indexes = index_by_id(&before_ir.operations);
    let after_indexes = index_by_id(&after_ir.operations);

    for (index, operation) in after_ir.operations.iter().enumerate() {
        if before_indexes.contains_key(operation.id.as_str()) {
            continue;
        }

        let site = operation_site(operation, DiffPosition::None, &operation.origin);

        emit_at(
            context,
            &site.site(),
            RawChange::new(
                DiffKind::OperationAdded,
                "added",
                pointer_below("", &["operations", &index.to_string()]),
            )
            .between(None, Some(text_value(operation.id.as_str()))),
        );
    }

    for (index, operation) in before_ir.operations.iter().enumerate() {
        let Some((after_index, after_operation)) = after_indexes
            .get(operation.id.as_str())
            .and_then(|found| after_ir.operations.get(*found).map(|op| (*found, op)))
        else {
            let site = operation_site(operation, DiffPosition::None, &operation.origin);

            emit_at(
                context,
                &site.site(),
                RawChange::new(
                    DiffKind::OperationRemoved,
                    "removed",
                    pointer_below("", &["operations", &index.to_string()]),
                )
                .between(Some(text_value(operation.id.as_str())), None),
            );

            continue;
        };

        compare_operation(
            context,
            &pointer_below("", &["operations", &after_index.to_string()]),
            operation,
            after_operation,
        )?;
    }

    Ok(())
}

/// The index of each operation by id; a repeated id keeps its last index.
fn index_by_id(operations: &[Operation]) -> HashMap<&str, usize> {
    operations
        .iter()
        .enumerate()
        .map(|(index, operation)| (operation.id.as_str(), index))
        .collect()
}

/// The site of one operation's changes: the operation at `position`, with its origin.
pub(crate) fn operation_site(
    operation: &Operation,
    position: DiffPosition,
    origin: &Origin,
) -> OperationSite {
    operation_site_with_origin(operation, position, Some(origin))
}

/// The site of one operation's changes, with the origin of the element when it has one.
pub(crate) fn operation_site_with_origin(
    operation: &Operation,
    position: DiffPosition,
    origin: Option<&Origin>,
) -> OperationSite {
    OperationSite {
        reaches: vec![ChangeReach {
            position,
            operations: vec![operation.id.as_str().to_owned()],
            facts: Vec::new(),
        }],
        origin: origin.map(ElementOrigin::from),
    }
}

fn compare_operation(
    context: &mut WalkContext<'_>,
    pointer: &str,
    before: &Operation,
    after: &Operation,
) -> Result<(), DiffError> {
    let operation_site = operation_site(after, DiffPosition::None, &after.origin);
    let site = operation_site.site();

    for operation in [before, after] {
        if operation.kind != DeclarationKind::HttpOperation {
            refuse_unknown_value(
                context,
                &site,
                &pointer_below(pointer, &["kind"]),
                operation.kind.as_str(),
            );

            return Ok(());
        }
    }

    let input = operation_site_of(after, DiffPosition::Input);
    let output = operation_site_of(after, DiffPosition::Output);
    let mut comparisons = MemberComparisons::new();

    comparisons.extend(access_comparisons(&input, &output, before, after));
    comparisons.extend(behaviour_comparisons(&input, &output, before, after));

    insert_route_comparisons(&mut comparisons, &site);

    comparisons.insert(
        "params",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_params(context, member_pointer, before, after)
        }),
    );
    comparisons.insert(
        "input",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_body(
                context,
                member_pointer,
                after,
                before.input.as_ref(),
                after.input.as_ref(),
            )
        }),
    );
    comparisons.insert(
        "responses",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_responses(
                context,
                member_pointer,
                after,
                &before.responses,
                &after.responses,
            )
        }),
    );
    comparisons.insert(
        "deprecated",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_deprecation(
                context,
                &site,
                member_pointer,
                before.deprecated.as_ref(),
                after.deprecated.as_ref(),
            )
        }),
    );
    comparisons.insert(
        "maturity",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_operation_maturity(
                context,
                &site,
                member_pointer,
                &before.maturity,
                &after.maturity,
            )
        }),
    );
    comparisons.insert(
        "format",
        Box::new(|context, member_pointer, before_value, after_value| {
            emit_at(
                context,
                &site,
                RawChange::new(
                    DiffKind::OperationFormat,
                    "changed",
                    member_pointer.to_owned(),
                )
                .between(before_value.cloned(), after_value.cloned()),
            );

            Ok(())
        }),
    );

    compare_members(
        context,
        &site,
        IrDefinition::Operation,
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}

/// The comparisons of the members that are an operation's route.
fn insert_route_comparisons<'comparison>(
    comparisons: &mut MemberComparisons<'comparison>,
    site: &'comparison ChangeSite<'comparison>,
) {
    for (member, route_case) in [
        ("surface", "surface"),
        ("method", "method"),
        ("path", "path"),
    ] {
        comparisons.insert(
            member,
            Box::new(|context, member_pointer, before_value, after_value| {
                emit_route(
                    context,
                    site,
                    route_case,
                    member_pointer,
                    before_value,
                    after_value,
                );

                Ok(())
            }),
        );
    }
}

/// The site of the changes `after` makes at `position`.
fn operation_site_of(after: &Operation, position: DiffPosition) -> OperationSite {
    operation_site(after, position, &after.origin)
}

fn emit_route(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    route_case: &str,
    pointer: &str,
    before: Option<&JsonValue>,
    after: Option<&JsonValue>,
) {
    emit_at(
        context,
        site,
        RawChange::new(DiffKind::OperationRoute, route_case, pointer.to_owned())
            .between(before.cloned(), after.cloned()),
    );
}

/// Compares the maturity of two operations: the level moves, any other member by its row.
fn compare_operation_maturity(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &OperationMaturity,
    after: &OperationMaturity,
) -> Result<(), DiffError> {
    let mut comparisons = MemberComparisons::new();

    comparisons.insert(
        "level",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_maturity_level(context, site, member_pointer, &before.level, &after.level);

            Ok(())
        }),
    );

    compare_members(
        context,
        site,
        IrDefinition::OperationMaturity,
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}
