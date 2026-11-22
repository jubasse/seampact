//! The comparison of how an operation behaves: errors, idempotency, concurrency and paging.

use seampact_diff_table::{DiffKind, IrDefinition};
use seampact_ir::{
    DerivedIdempotency, Idempotency, KnownIdempotencyRef, Operation, OperationError, Paging,
    SortKey,
};

use crate::DiffError;
use crate::change_sink::RawChange;
use crate::not_ported::not_ported_yet;
use crate::walk_access::emit_presence;
use crate::walk_context::{
    ChangeSite, MemberComparisons, WalkContext, compare_members, emit_at, refuse_unknown_value,
};
use crate::walk_json::{object_members, text_value};
use crate::walk_operations::OperationSite;
use crate::walk_type_use::{BoundSide, compare_bound};

/// The case of a `paging` change by the policy an over-limit request moves to.
fn over_limit_case(policy: &str) -> Option<&'static str> {
    match policy {
        "reject" => Some("overLimitRejected"),
        "clamp" => Some("overLimitClamped"),
        _ => None,
    }
}

/// The comparisons of the behaviour members of two operations: errors and the output side go to
/// `output`, the rest to `input`.
pub(crate) fn behaviour_comparisons<'comparison>(
    input: &'comparison OperationSite,
    output: &'comparison OperationSite,
    before: &'comparison Operation,
    after: &'comparison Operation,
) -> MemberComparisons<'comparison> {
    let mut comparisons = MemberComparisons::new();

    comparisons.insert(
        "errors",
        Box::new(|context, pointer, _before_value, _after_value| {
            compare_errors(
                context,
                &output.site(),
                pointer,
                &before.errors,
                &after.errors,
            )
        }),
    );
    comparisons.insert(
        "idempotency",
        Box::new(|context, pointer, _before_value, _after_value| {
            compare_idempotency(
                context,
                (&input.site(), &output.site()),
                pointer,
                before.idempotency.as_ref(),
                after.idempotency.as_ref(),
            )
        }),
    );
    comparisons.insert(
        "concurrency",
        Box::new(|context, pointer, _before_value, _after_value| {
            let (Some(before_concurrency), Some(after_concurrency)) =
                (&before.concurrency, &after.concurrency)
            else {
                emit_presence(
                    context,
                    &input.site(),
                    DiffKind::Concurrency,
                    pointer,
                    before
                        .concurrency
                        .as_ref()
                        .map(|found| text_value(&found.field)),
                    after
                        .concurrency
                        .as_ref()
                        .map(|found| text_value(&found.field)),
                );

                return Ok(());
            };

            compare_members(
                context,
                &input.site(),
                IrDefinition::Concurrency,
                pointer,
                Some(&object_members(before_concurrency)?),
                Some(&object_members(after_concurrency)?),
                &MemberComparisons::new(),
            )
        }),
    );
    comparisons.insert(
        "paging",
        Box::new(|context, pointer, _before_value, _after_value| {
            compare_paging(
                context,
                &input.site(),
                pointer,
                before.paging.as_ref(),
                after.paging.as_ref(),
            )
        }),
    );

    comparisons
}

/// The derived idempotency, when that is the kind of the one given and this revision knows it.
fn derived_of(idempotency: Option<&Idempotency>) -> Option<&DerivedIdempotency> {
    match KnownIdempotencyRef::try_from(idempotency?) {
        Ok(KnownIdempotencyRef::Derived(derived)) => Some(derived),
        Ok(_) | Err(_) => None,
    }
}

/// Compares the paging of two operations: gained or lost, else member by member.
fn compare_paging(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: Option<&Paging>,
    after: Option<&Paging>,
) -> Result<(), DiffError> {
    let (Some(before_paging), Some(after_paging)) = (before, after) else {
        emit_at(
            context,
            site,
            RawChange::new(
                DiffKind::Paging,
                if before.is_none() { "added" } else { "removed" },
                pointer.to_owned(),
            )
            .between(
                before
                    .and_then(|paging| paging.style.as_ref())
                    .map(|style| text_value(style.as_str())),
                after
                    .and_then(|paging| paging.style.as_ref())
                    .map(|style| text_value(style.as_str())),
            ),
        );

        return Ok(());
    };
    let mut comparisons = MemberComparisons::new();

    comparisons.insert(
        "maxLimit",
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
    comparisons.insert(
        "overLimit",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            let policy = after_paging.over_limit.as_str();
            let Some(case_name) = over_limit_case(policy) else {
                return refuse_unknown_value(context, site, member_pointer, policy);
            };

            emit_at(
                context,
                site,
                RawChange::new(DiffKind::Paging, case_name, member_pointer.to_owned()).between(
                    Some(text_value(before_paging.over_limit.as_str())),
                    Some(text_value(policy)),
                ),
            );

            Ok(())
        }),
    );
    comparisons.insert(
        "sortKeys",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_sort_keys(
                context,
                site,
                member_pointer,
                &before_paging.sort_keys,
                &after_paging.sort_keys,
            )
        }),
    );

    compare_members(
        context,
        site,
        IrDefinition::Paging,
        pointer,
        Some(&object_members(before_paging)?),
        Some(&object_members(after_paging)?),
        &comparisons,
    )
}

/// Compares the errors of two operations.
///
/// # Errors
///
/// Not ported yet.
fn compare_errors(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: &[OperationError],
    _after: &[OperationError],
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareErrors"))
}

/// Compares the idempotency of two operations; `sites` are the input and the output site.
///
/// # Errors
///
/// Not ported yet.
fn compare_idempotency(
    _context: &mut WalkContext<'_>,
    _sites: (&ChangeSite<'_>, &ChangeSite<'_>),
    _pointer: &str,
    _before: Option<&Idempotency>,
    _after: Option<&Idempotency>,
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareIdempotency"))
}

/// Compares the sort keys of two pagings.
///
/// # Errors
///
/// Not ported yet.
fn compare_sort_keys(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: &[SortKey],
    _after: &[SortKey],
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareSortKeys"))
}
