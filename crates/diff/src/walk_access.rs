//! The comparison of who may call an operation: access, caller kinds, requirements, scopes, bindings,
//! field rights, csrf, owner and the unknown-query policy.

use seampact_diff_table::{DiffKind, DiffPosition, IrDefinition};
use seampact_ir::{
    Access, Binding, Csrf, Direction, FieldRight, KnownAccessRef, Operation, OperationScope,
    PrincipalRequirement, RefusedCredential, Requirement,
};
use seampact_json::{JsonValue, stringify_json};

use crate::DiffError;
use crate::change_sink::{ChangeReach, RawChange};
use crate::not_ported::not_ported_yet;
use crate::walk_context::{
    ChangeSite, KeyedListComparison, MemberComparisons, WalkContext, compare_kept_order,
    compare_keyed_list, compare_members, emit_at, refuse_unknown_value,
};
use crate::walk_json::{json_of, object_members, pointer_join, text_value};
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

        refuse_unknown_value(context, site, &pointer_join(pointer, &["policy"]), unknown);

        return Ok(());
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

/// Compares the principal requirements of two operations by field.
fn compare_principal_requirements(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &[PrincipalRequirement],
    after: &[PrincipalRequirement],
) -> Result<(), DiffError> {
    let comparison = KeyedListComparison {
        key_of: Box::new(|requirement: &PrincipalRequirement| Ok(requirement.field.clone())),
        added: Box::new(|context, entry_pointer, requirement| {
            emit_at(
                context,
                site,
                RawChange::new(
                    DiffKind::PrincipalRequirement,
                    "added",
                    entry_pointer.to_owned(),
                )
                .between(None, Some(text_value(&requirement.field))),
            );

            Ok(())
        }),
        removed: Box::new(|context, entry_pointer, requirement| {
            emit_at(
                context,
                site,
                RawChange::new(
                    DiffKind::PrincipalRequirement,
                    "removed",
                    entry_pointer.to_owned(),
                )
                .between(Some(text_value(&requirement.field)), None),
            );

            Ok(())
        }),
        kept: Box::new(|context, entry_pointer, before_entry, after_entry| {
            compare_members(
                context,
                site,
                IrDefinition::PrincipalRequirement,
                entry_pointer,
                Some(&object_members(before_entry)?),
                Some(&object_members(after_entry)?),
                &MemberComparisons::new(),
            )
        }),
    };

    compare_keyed_list(context, pointer, before, after, &comparison)
}

/// Compares the scopes of two operations by scope id, then their order.
fn compare_scopes(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &[OperationScope],
    after: &[OperationScope],
) -> Result<(), DiffError> {
    let comparison = KeyedListComparison {
        key_of: Box::new(|scope: &OperationScope| Ok(scope.scope.as_str().to_owned())),
        added: Box::new(|context, entry_pointer, scope| {
            emit_at(
                context,
                site,
                RawChange::new(DiffKind::Scope, "added", entry_pointer.to_owned())
                    .between(None, Some(text_value(scope.scope.as_str()))),
            );

            Ok(())
        }),
        removed: Box::new(|context, entry_pointer, scope| {
            emit_at(
                context,
                site,
                RawChange::new(DiffKind::Scope, "removed", entry_pointer.to_owned())
                    .between(Some(text_value(scope.scope.as_str())), None),
            );

            Ok(())
        }),
        kept: Box::new(|context, entry_pointer, before_entry, after_entry| {
            compare_members(
                context,
                site,
                IrDefinition::OperationScope,
                entry_pointer,
                Some(&object_members(before_entry)?),
                Some(&object_members(after_entry)?),
                &MemberComparisons::new(),
            )
        }),
    };

    compare_keyed_list(context, pointer, before, after, &comparison)?;

    let before_names: Vec<&str> = before.iter().map(|scope| scope.scope.as_str()).collect();
    let after_names: Vec<&str> = after.iter().map(|scope| scope.scope.as_str()).collect();

    compare_kept_order(
        context,
        site,
        pointer,
        "scopes",
        &before_names,
        &after_names,
    );

    Ok(())
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

/// Compares the bindings of two operations by where they write.
fn compare_bindings(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &[Binding],
    after: &[Binding],
) -> Result<(), DiffError> {
    let comparison = KeyedListComparison {
        key_of: Box::new(|binding: &Binding| Ok(stringify_json(&json_of(&binding.to)?))),
        added: Box::new(|context, entry_pointer, _binding| {
            emit_at(
                context,
                site,
                RawChange::new(DiffKind::Binding, "added", entry_pointer.to_owned()),
            );

            Ok(())
        }),
        removed: Box::new(|context, entry_pointer, _binding| {
            emit_at(
                context,
                site,
                RawChange::new(DiffKind::Binding, "removed", entry_pointer.to_owned()),
            );

            Ok(())
        }),
        kept: Box::new(|context, entry_pointer, before_entry, after_entry| {
            let mut comparisons = MemberComparisons::new();

            comparisons.insert(
                "from",
                Box::new(|context, member_pointer, _before_value, _after_value| {
                    emit_at(
                        context,
                        site,
                        RawChange::new(DiffKind::Binding, "changed", member_pointer.to_owned()),
                    );

                    Ok(())
                }),
            );

            compare_members(
                context,
                site,
                IrDefinition::Binding,
                entry_pointer,
                Some(&object_members(before_entry)?),
                Some(&object_members(after_entry)?),
                &comparisons,
            )
        }),
    };

    compare_keyed_list(context, pointer, before, after, &comparison)
}

/// Whether a field right was added, removed or changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FieldRightCase {
    Added,
    Removed,
    Changed,
}

impl FieldRightCase {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Added => "added",
            Self::Removed => "removed",
            Self::Changed => "changed",
        }
    }
}

/// The one reach a field right changes at: its direction, over the operations of `input`.
/// A direction other than input and output refuses the diff and has none.
fn field_right_reaches(
    context: &mut WalkContext<'_>,
    input: &ChangeSite<'_>,
    list_pointer: &str,
    field_right: &FieldRight,
) -> Option<Vec<ChangeReach>> {
    let position = match field_right.direction {
        Direction::Input => DiffPosition::Input,
        Direction::Output => DiffPosition::Output,
        Direction::Unknown(_) => {
            refuse_unknown_value(
                context,
                input,
                &pointer_join(list_pointer, &["direction"]),
                field_right.direction.as_str(),
            );

            return None;
        }
    };
    let operations: Vec<String> = input
        .reaches
        .iter()
        .flat_map(|reach| reach.operations.iter().cloned())
        .collect();

    Some(vec![ChangeReach {
        position,
        operations,
        facts: Vec::new(),
    }])
}

/// Emits a field right change at its direction; the removed one reports `before`, the others `after`.
fn emit_field_right(
    context: &mut WalkContext<'_>,
    input: &ChangeSite<'_>,
    list_pointer: &str,
    field_right_case: FieldRightCase,
    entry_pointer: &str,
    field_right: &FieldRight,
) {
    let Some(reaches) = field_right_reaches(context, input, list_pointer, field_right) else {
        return;
    };
    let site = ChangeSite {
        reaches: &reaches,
        origin: input.origin.clone(),
    };
    let right = Some(text_value(field_right.right.as_str()));
    let change = RawChange::new(
        DiffKind::FieldRight,
        field_right_case.as_str(),
        entry_pointer.to_owned(),
    );

    emit_at(
        context,
        &site,
        if field_right_case == FieldRightCase::Removed {
            change.between(right, None)
        } else {
            change.between(None, right)
        },
    );
}

/// Compares the field rights of two operations by direction, schema and pointer.
fn compare_field_rights(
    context: &mut WalkContext<'_>,
    input: &ChangeSite<'_>,
    pointer: &str,
    before: &[FieldRight],
    after: &[FieldRight],
) -> Result<(), DiffError> {
    let comparison = KeyedListComparison {
        key_of: Box::new(|field_right: &FieldRight| {
            Ok(format!(
                "{}\u{0}{}\u{0}{}",
                field_right.direction.as_str(),
                field_right.schema.as_str(),
                field_right.pointer
            ))
        }),
        added: Box::new(|context, entry_pointer, field_right| {
            emit_field_right(
                context,
                input,
                pointer,
                FieldRightCase::Added,
                entry_pointer,
                field_right,
            );

            Ok(())
        }),
        removed: Box::new(|context, entry_pointer, field_right| {
            emit_field_right(
                context,
                input,
                pointer,
                FieldRightCase::Removed,
                entry_pointer,
                field_right,
            );

            Ok(())
        }),
        kept: Box::new(|context, entry_pointer, before_entry, after_entry| {
            let Some(reaches) = field_right_reaches(context, input, pointer, after_entry) else {
                return Ok(());
            };
            let site = ChangeSite {
                reaches: &reaches,
                origin: input.origin.clone(),
            };
            let mut comparisons = MemberComparisons::new();

            comparisons.insert(
                "right",
                Box::new(|context, _member_pointer, _before_value, _after_value| {
                    emit_field_right(
                        context,
                        input,
                        pointer,
                        FieldRightCase::Changed,
                        entry_pointer,
                        after_entry,
                    );

                    Ok(())
                }),
            );

            compare_members(
                context,
                &site,
                IrDefinition::FieldRight,
                entry_pointer,
                Some(&object_members(before_entry)?),
                Some(&object_members(after_entry)?),
                &comparisons,
            )
        }),
    };

    compare_keyed_list(context, pointer, before, after, &comparison)
}

/// The rank of an access: the more callers it admits, the lower.
const PUBLIC_RANK: u8 = 0;
const OPTIONAL_ANONYMOUS_RANK: u8 = 1;
const OPTIONAL_REJECT_RANK: u8 = 2;
const IDENTITY_RANK: u8 = 3;

/// The case of an access that moves from one rank to another.
#[expect(dead_code, reason = "called by compareAccess, ported in brief 4")]
fn rank_change_case(before_rank: u8, after_rank: u8) -> &'static str {
    if before_rank == PUBLIC_RANK && after_rank == OPTIONAL_ANONYMOUS_RANK {
        return "principalOptionalAdded";
    }

    if before_rank == OPTIONAL_ANONYMOUS_RANK && after_rank == PUBLIC_RANK {
        return "principalOptionalRemoved";
    }

    if after_rank > before_rank {
        "tightened"
    } else {
        "loosened"
    }
}

/// The rank of an access; an optional access refused with an unknown value refuses the diff.
#[expect(dead_code, reason = "called by compareAccess, ported in brief 4")]
fn access_rank(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    access: KnownAccessRef<'_>,
) -> Option<u8> {
    match access {
        KnownAccessRef::Public(_) => Some(PUBLIC_RANK),
        KnownAccessRef::Identity(_) => Some(IDENTITY_RANK),
        KnownAccessRef::Optional(optional) => match &optional.on_refused {
            RefusedCredential::Anonymous => Some(OPTIONAL_ANONYMOUS_RANK),
            RefusedCredential::Reject => Some(OPTIONAL_REJECT_RANK),
            RefusedCredential::Unknown(unknown) => {
                refuse_unknown_value(
                    context,
                    site,
                    &pointer_join(pointer, &["onRefused"]),
                    unknown.as_str(),
                );

                None
            }
        },
    }
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
