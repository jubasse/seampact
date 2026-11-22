//! The comparison of who may call an operation: access, caller kinds, requirements, scopes, bindings,
//! field rights, csrf, owner and the unknown-query policy.

use seampact_diff_table::{DiffKind, IrDefinition};
use seampact_ir::{
    Access, Binding, Csrf, FieldRight, Operation, OperationScope, PrincipalRequirement, Requirement,
};
use seampact_json::JsonValue;

use crate::DiffError;
use crate::change_sink::RawChange;
use crate::not_ported::not_ported_yet;
use crate::walk_context::{
    ChangeSite, MemberComparisons, WalkContext, compare_members, emit_at, refuse_unknown_value,
};
use crate::walk_json::{object_members, pointer_join, text_value};
use crate::walk_operations::OperationSite;

/// The case of an `unknownQuery` change by the policy the operation moves to.
fn unknown_query_case(policy: &str) -> Option<&'static str> {
    match policy {
        "refuse" => Some("refused"),
        "ignore" => Some("ignored"),
        _ => None,
    }
}

/// The comparisons of the access members of two operations; changes go to `input`, except
/// `filteredBy`, which goes to `output`.
pub(crate) fn access_comparisons<'comparison>(
    input: &'comparison OperationSite,
    output: &'comparison OperationSite,
    before: &'comparison Operation,
    after: &'comparison Operation,
) -> MemberComparisons<'comparison> {
    let mut comparisons = MemberComparisons::new();

    insert_caller_comparisons(&mut comparisons, input, before, after);
    insert_requirement_comparisons(&mut comparisons, input, before, after);
    insert_protection_comparisons(&mut comparisons, input, output, before, after);

    comparisons
}

fn insert_caller_comparisons<'comparison>(
    comparisons: &mut MemberComparisons<'comparison>,
    input: &'comparison OperationSite,
    before: &'comparison Operation,
    after: &'comparison Operation,
) {
    comparisons.insert(
        "unknownQuery",
        Box::new(|context, pointer, _before_value, _after_value| {
            compare_unknown_query(context, &input.site(), pointer, before, after)
        }),
    );
    comparisons.insert(
        "access",
        Box::new(|context, pointer, _before_value, _after_value| {
            compare_access(
                context,
                &input.site(),
                pointer,
                &before.access,
                &after.access,
            )
        }),
    );
    comparisons.insert(
        "callerKinds",
        Box::new(|context, pointer, _before_value, _after_value| {
            compare_caller_kinds(context, &input.site(), pointer, before, after)
        }),
    );
    comparisons.insert(
        "principalRequires",
        Box::new(|context, pointer, _before_value, _after_value| {
            compare_principal_requirements(
                context,
                &input.site(),
                pointer,
                &before.principal_requires,
                &after.principal_requires,
            )
        }),
    );
}

fn insert_requirement_comparisons<'comparison>(
    comparisons: &mut MemberComparisons<'comparison>,
    input: &'comparison OperationSite,
    before: &'comparison Operation,
    after: &'comparison Operation,
) {
    comparisons.insert(
        "scopes",
        Box::new(|context, pointer, _before_value, _after_value| {
            compare_scopes(
                context,
                &input.site(),
                pointer,
                &before.scopes,
                &after.scopes,
            )
        }),
    );
    comparisons.insert(
        "requires",
        Box::new(|context, pointer, _before_value, _after_value| {
            compare_requirements(
                context,
                &input.site(),
                pointer,
                &before.requires,
                &after.requires,
            )
        }),
    );
    comparisons.insert(
        "bindings",
        Box::new(|context, pointer, _before_value, _after_value| {
            compare_bindings(
                context,
                &input.site(),
                pointer,
                &before.bindings,
                &after.bindings,
            )
        }),
    );
    comparisons.insert(
        "fieldRights",
        Box::new(|context, pointer, _before_value, _after_value| {
            compare_field_rights(
                context,
                &input.site(),
                pointer,
                &before.field_rights,
                &after.field_rights,
            )
        }),
    );
}

fn insert_protection_comparisons<'comparison>(
    comparisons: &mut MemberComparisons<'comparison>,
    input: &'comparison OperationSite,
    output: &'comparison OperationSite,
    before: &'comparison Operation,
    after: &'comparison Operation,
) {
    comparisons.insert(
        "filteredBy",
        Box::new(|context, pointer, before_value, after_value| {
            emit_presence(
                context,
                &output.site(),
                DiffKind::FilteredBy,
                pointer,
                before_value.cloned(),
                after_value.cloned(),
            );

            Ok(())
        }),
    );
    comparisons.insert(
        "csrf",
        Box::new(|context, pointer, _before_value, _after_value| {
            compare_csrf(
                context,
                &input.site(),
                pointer,
                before.csrf.as_ref(),
                after.csrf.as_ref(),
            )
        }),
    );
    comparisons.insert(
        "owner",
        Box::new(|context, pointer, _before_value, _after_value| {
            let (Some(before_owner), Some(after_owner)) = (&before.owner, &after.owner) else {
                emit_presence(
                    context,
                    &input.site(),
                    DiffKind::Owner,
                    pointer,
                    before
                        .owner
                        .as_ref()
                        .map(|owner| text_value(owner.kind.as_str())),
                    after
                        .owner
                        .as_ref()
                        .map(|owner| text_value(owner.kind.as_str())),
                );

                return Ok(());
            };

            compare_members(
                context,
                &input.site(),
                IrDefinition::Owner,
                pointer,
                Some(&object_members(before_owner)?),
                Some(&object_members(after_owner)?),
                &MemberComparisons::new(),
            )
        }),
    );
}

/// A change of presence: added when `before` is absent, removed when `after` is, else changed.
pub(crate) fn emit_presence(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    kind: DiffKind,
    pointer: &str,
    before: Option<JsonValue>,
    after: Option<JsonValue>,
) {
    let presence_case = if before.is_none() {
        "added"
    } else if after.is_none() {
        "removed"
    } else {
        "changed"
    };

    emit_at(
        context,
        site,
        RawChange::new(kind, presence_case, pointer.to_owned()).between(before, after),
    );
}

/// Compares the unknown-query policy of two operations: a move between policies, else the members.
fn compare_unknown_query(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &Operation,
    after: &Operation,
) -> Result<(), DiffError> {
    let before_policy = before.unknown_query.tag();
    let after_policy = after.unknown_query.tag();
    let policy_case = unknown_query_case(after_policy);

    let (Some(policy_case), Some(_)) = (policy_case, unknown_query_case(before_policy)) else {
        let unknown = if policy_case.is_none() {
            after_policy
        } else {
            before_policy
        };

        return refuse_unknown_value(context, site, &pointer_join(pointer, &["policy"]), unknown);
    };

    if before_policy != after_policy {
        emit_at(
            context,
            site,
            RawChange::new(DiffKind::UnknownQuery, policy_case, pointer.to_owned()).between(
                Some(text_value(before_policy)),
                Some(text_value(after_policy)),
            ),
        );

        return Ok(());
    }

    let definition = if after_policy == "refuse" {
        IrDefinition::RefuseUnknownQuery
    } else {
        IrDefinition::IgnoreUnknownQuery
    };

    compare_members(
        context,
        site,
        definition,
        pointer,
        Some(&object_members(&before.unknown_query)?),
        Some(&object_members(&after.unknown_query)?),
        &MemberComparisons::new(),
    )
}

/// Compares the access of two operations.
///
/// # Errors
///
/// Not ported yet.
fn compare_access(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: &Access,
    _after: &Access,
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareAccess"))
}

/// Compares the caller kinds of two operations.
///
/// # Errors
///
/// Not ported yet.
fn compare_caller_kinds(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: &Operation,
    _after: &Operation,
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareCallerKinds"))
}

/// Compares the principal requirements of two operations.
///
/// # Errors
///
/// Not ported yet.
fn compare_principal_requirements(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: &[PrincipalRequirement],
    _after: &[PrincipalRequirement],
) -> Result<(), DiffError> {
    Err(not_ported_yet("comparePrincipalRequirements"))
}

/// Compares the scopes of two operations.
///
/// # Errors
///
/// Not ported yet.
fn compare_scopes(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: &[OperationScope],
    _after: &[OperationScope],
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareScopes"))
}

/// Compares the requirements of two operations.
///
/// # Errors
///
/// Not ported yet.
fn compare_requirements(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: &[Requirement],
    _after: &[Requirement],
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareRequirements"))
}

/// Compares the bindings of two operations.
///
/// # Errors
///
/// Not ported yet.
fn compare_bindings(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: &[Binding],
    _after: &[Binding],
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareBindings"))
}

/// Compares the field rights of two operations.
///
/// # Errors
///
/// Not ported yet.
fn compare_field_rights(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: &[FieldRight],
    _after: &[FieldRight],
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareFieldRights"))
}

/// Compares the csrf protection of two operations.
///
/// # Errors
///
/// Not ported yet.
fn compare_csrf(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: Option<&Csrf>,
    _after: Option<&Csrf>,
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareCsrf"))
}
