//! The comparison of how an operation behaves: errors, idempotency, concurrency and paging.

use seampact_diff_table::{DiffKind, IrDefinition};
use seampact_ir::{
    DerivedIdempotency, Idempotency, IdempotencyEnforcement, KnownIdempotencyRef, Operation,
    OperationError, Paging, RetryHeader, SortKey,
};

use crate::DiffError;
use crate::change_sink::RawChange;
use crate::not_ported::not_ported_yet;
use crate::walk_access::emit_presence;
use crate::walk_context::{
    ChangeSite, KeyedListComparison, MemberComparisons, WalkContext, compare_keyed_list,
    compare_members, emit_at, refuse_unknown_value,
};
use crate::walk_json::{object_members, pointer_join, text_value};
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
                refuse_unknown_value(context, site, member_pointer, policy);

                return Ok(());
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

/// Compares the errors of two operations by code; a kept error is compared by member.
fn compare_errors(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &[OperationError],
    after: &[OperationError],
) -> Result<(), DiffError> {
    let comparison = KeyedListComparison {
        key_of: Box::new(|error: &OperationError| Ok(error.code.as_str().to_owned())),
        added: Box::new(|context, entry_pointer, error| {
            emit_at(
                context,
                site,
                RawChange::new(DiffKind::Error, "added", entry_pointer.to_owned())
                    .between(None, Some(text_value(error.code.as_str()))),
            );

            Ok(())
        }),
        removed: Box::new(|context, entry_pointer, error| {
            emit_at(
                context,
                site,
                RawChange::new(DiffKind::Error, "removed", entry_pointer.to_owned())
                    .between(Some(text_value(error.code.as_str())), None),
            );

            Ok(())
        }),
        kept: Box::new(|context, entry_pointer, before_error, after_error| {
            let mut comparisons = MemberComparisons::new();

            comparisons.insert(
                "retryHeader",
                Box::new(|context, member_pointer, _before_value, _after_value| {
                    compare_retry_header(
                        context,
                        site,
                        member_pointer,
                        before_error.retry_header.as_ref(),
                        after_error.retry_header.as_ref(),
                    )
                }),
            );

            compare_members(
                context,
                site,
                IrDefinition::OperationError,
                entry_pointer,
                Some(&object_members(before_error)?),
                Some(&object_members(after_error)?),
                &comparisons,
            )
        }),
    };

    compare_keyed_list(context, pointer, before, after, &comparison)
}

/// Compares the retry header of two errors: gained or lost, else by member.
fn compare_retry_header(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: Option<&RetryHeader>,
    after: Option<&RetryHeader>,
) -> Result<(), DiffError> {
    let (Some(before_header), Some(after_header)) = (before, after) else {
        emit_at(
            context,
            site,
            RawChange::new(
                DiffKind::Error,
                if before.is_none() {
                    "retryHeaderAdded"
                } else {
                    "retryHeaderRemoved"
                },
                pointer.to_owned(),
            )
            .between(
                before.map(|header| text_value(&header.name)),
                after.map(|header| text_value(&header.name)),
            ),
        );

        return Ok(());
    };

    compare_members(
        context,
        site,
        IrDefinition::RetryHeader,
        pointer,
        Some(&object_members(before_header)?),
        Some(&object_members(after_header)?),
        &MemberComparisons::new(),
    )
}

/// The case of a lifetime change: a shorter one lets a replay reach the handler sooner; a longer
/// one, under a boundary, replays or refuses a key that `before` clients reused once it expired.
fn lifetime_case(before: &DerivedIdempotency, after: &DerivedIdempotency) -> &'static str {
    if after.lifetime_ms < before.lifetime_ms {
        return "lifetimeShortened";
    }

    if after.enforce == IdempotencyEnforcement::Boundary {
        "lifetimeLengthened"
    } else {
        "lifetimeLengthenedUnenforced"
    }
}

/// The case of an `enforce` change by the enforcement the idempotency moves to.
fn enforce_case(enforcement: &str) -> Option<&'static str> {
    match enforcement {
        "boundary" => Some("enforceAdded"),
        "none" => Some("enforceDropped"),
        _ => None,
    }
}

/// Compares the idempotency of two operations; `sites` are the input and the output site.
fn compare_idempotency(
    context: &mut WalkContext<'_>,
    sites: (&ChangeSite<'_>, &ChangeSite<'_>),
    pointer: &str,
    before: Option<&Idempotency>,
    after: Option<&Idempotency>,
) -> Result<(), DiffError> {
    let input = sites.0;

    if let Some(unknown) = [before, after]
        .into_iter()
        .flatten()
        .find(|idempotency| KnownIdempotencyRef::try_from(*idempotency).is_err())
    {
        refuse_unknown_value(
            context,
            input,
            &pointer_join(pointer, &["kind"]),
            unknown.tag(),
        );

        return Ok(());
    }

    let kind_of =
        |idempotency: Option<&Idempotency>| idempotency.map(|found| text_value(found.tag()));

    match (derived_of(before), derived_of(after)) {
        (Some(before_on), Some(after_on)) => {
            compare_derived_idempotency(context, sites, pointer, before_on, after_on)
        }
        (_, Some(after_on)) => {
            emit_at(
                context,
                input,
                RawChange::new(
                    DiffKind::Idempotency,
                    if after_on.required {
                        "addedRequired"
                    } else {
                        "addedOptional"
                    },
                    pointer.to_owned(),
                )
                .between(kind_of(before), kind_of(after)),
            );

            Ok(())
        }
        (Some(_), None) => {
            emit_at(
                context,
                input,
                RawChange::new(DiffKind::Idempotency, "removed", pointer.to_owned())
                    .between(kind_of(before), kind_of(after)),
            );

            Ok(())
        }
        // Off on both sides: an exemption added, removed or reworded.
        (None, None) => {
            emit_at(
                context,
                input,
                RawChange::new(DiffKind::Annotation, "idempotency", pointer.to_owned())
                    .between(kind_of(before), kind_of(after)),
            );

            Ok(())
        }
    }
}

/// Compares two derived idempotencies by member; the replay header is an output.
fn compare_derived_idempotency(
    context: &mut WalkContext<'_>,
    sites: (&ChangeSite<'_>, &ChangeSite<'_>),
    pointer: &str,
    before: &DerivedIdempotency,
    after: &DerivedIdempotency,
) -> Result<(), DiffError> {
    let (input, output) = sites;
    let mut comparisons = MemberComparisons::new();

    comparisons.insert(
        "required",
        Box::new(|context, member_pointer, before_value, after_value| {
            emit_at(
                context,
                input,
                RawChange::new(
                    DiffKind::Idempotency,
                    if after.required {
                        "optionalToRequired"
                    } else {
                        "requiredToOptional"
                    },
                    member_pointer.to_owned(),
                )
                .between(before_value.cloned(), after_value.cloned()),
            );

            Ok(())
        }),
    );
    comparisons.insert(
        "lifetimeMs",
        Box::new(|context, member_pointer, before_value, after_value| {
            emit_at(
                context,
                input,
                RawChange::new(
                    DiffKind::Idempotency,
                    lifetime_case(before, after),
                    member_pointer.to_owned(),
                )
                .between(before_value.cloned(), after_value.cloned()),
            );

            Ok(())
        }),
    );
    comparisons.insert(
        "enforce",
        Box::new(|context, member_pointer, before_value, after_value| {
            let Some(case_name) = enforce_case(after.enforce.as_str()) else {
                refuse_unknown_value(context, input, member_pointer, after.enforce.as_str());

                return Ok(());
            };

            emit_at(
                context,
                input,
                RawChange::new(DiffKind::Idempotency, case_name, member_pointer.to_owned())
                    .between(before_value.cloned(), after_value.cloned()),
            );

            Ok(())
        }),
    );
    comparisons.insert(
        "replayHeader",
        Box::new(|context, member_pointer, before_value, after_value| {
            emit_at(
                context,
                output,
                RawChange::new(
                    DiffKind::Idempotency,
                    "replayHeader",
                    member_pointer.to_owned(),
                )
                .between(before_value.cloned(), after_value.cloned()),
            );

            Ok(())
        }),
    );

    compare_members(
        context,
        input,
        IrDefinition::DerivedIdempotency,
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
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
