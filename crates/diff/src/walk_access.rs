//! The comparison of who may call an operation: access, caller kinds, requirements, scopes, bindings,
//! field rights, csrf, owner and the unknown-query policy.

use seampact_diff_table::{DiffKind, DiffPosition, IrDefinition};
use seampact_ir::{
    Access, Binding, CallerKind, Csrf, Direction, FieldRight, KnownAccessRef, KnownCsrfRef,
    KnownRequirementRef, Operation, OperationScope, PrincipalRequirement, RefusedCredential,
    Requirement, SchemeId,
};
use seampact_json::{JsonValue, stringify_json};
use serde::Serialize;

use crate::DiffError;
use crate::change_sink::{ChangeReach, RawChange};
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
            compare_caller_kinds(context, &input.site(), pointer, before, after);

            Ok(())
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

/// Compares the access of two operations: a move between ranks, then the members of the kind.
fn compare_access(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &Access,
    after: &Access,
) -> Result<(), DiffError> {
    let (Ok(known_before), Ok(known_after)) = (
        KnownAccessRef::try_from(before),
        KnownAccessRef::try_from(after),
    ) else {
        let unknown = if KnownAccessRef::try_from(before).is_err() {
            before
        } else {
            after
        };

        refuse_unknown_value(
            context,
            site,
            &pointer_join(pointer, &["kind"]),
            unknown.tag(),
        );

        return Ok(());
    };
    let (Some(before_rank), Some(after_rank)) = (
        access_rank(context, site, pointer, known_before),
        access_rank(context, site, pointer, known_after),
    ) else {
        return Ok(());
    };

    if before_rank != after_rank {
        emit_at(
            context,
            site,
            RawChange::new(
                DiffKind::Access,
                rank_change_case(before_rank, after_rank),
                pointer.to_owned(),
            )
            .between(
                Some(text_value(before.tag())),
                Some(text_value(after.tag())),
            ),
        );
    }

    let credentials = match (known_before, known_after) {
        (KnownAccessRef::Public(_), _) | (_, KnownAccessRef::Public(_)) => None,
        (before_credentials, after_credentials) => Some((
            schemes_of(before_credentials),
            schemes_of(after_credentials),
        )),
    };
    let comparisons = access_member_comparisons(site, credentials);

    compare_members(
        context,
        site,
        access_definition(known_after),
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}

/// The comparisons of the members of an access; `credentials` holds the schemes of both sides
/// when neither is public.
fn access_member_comparisons<'comparison>(
    site: &'comparison ChangeSite<'_>,
    credentials: Option<(Vec<&'comparison str>, Vec<&'comparison str>)>,
) -> MemberComparisons<'comparison> {
    let has_credentials = credentials.is_some();
    let mut comparisons = MemberComparisons::new();

    comparisons.insert(
        "kind",
        Box::new(|_context, _pointer, _before_value, _after_value| Ok(())),
    );
    comparisons.insert(
        "onRefused",
        Box::new(|_context, _pointer, _before_value, _after_value| Ok(())),
    );
    comparisons.insert(
        "reason",
        Box::new(|context, member_pointer, before_value, after_value| {
            emit_at(
                context,
                site,
                RawChange::new(DiffKind::Annotation, "reason", member_pointer.to_owned())
                    .between(before_value.cloned(), after_value.cloned()),
            );

            Ok(())
        }),
    );
    comparisons.insert(
        "identity",
        Box::new(move |context, member_pointer, before_value, after_value| {
            // A public access holds neither: the rank change says it all.
            if has_credentials {
                emit_at(
                    context,
                    site,
                    RawChange::new(DiffKind::Access, "identity", member_pointer.to_owned())
                        .between(before_value.cloned(), after_value.cloned()),
                );
            }

            Ok(())
        }),
    );
    comparisons.insert(
        "schemes",
        Box::new(
            move |context, member_pointer, _before_value, _after_value| {
                if let Some((before_schemes, after_schemes)) = &credentials {
                    compare_names(
                        context,
                        site,
                        member_pointer,
                        NameChange {
                            kind: DiffKind::Access,
                            added_case: "schemeAdded",
                            removed_case: "schemeRemoved",
                        },
                        before_schemes,
                        after_schemes,
                    );
                }

                Ok(())
            },
        ),
    );

    comparisons
}

fn access_definition(access: KnownAccessRef<'_>) -> IrDefinition {
    match access {
        KnownAccessRef::Identity(_) => IrDefinition::IdentityAccess,
        KnownAccessRef::Optional(_) => IrDefinition::OptionalAccess,
        KnownAccessRef::Public(_) => IrDefinition::PublicAccess,
    }
}

/// The scheme ids an access with credentials accepts; a public access has none.
fn schemes_of(access: KnownAccessRef<'_>) -> Vec<&str> {
    let schemes = match access {
        KnownAccessRef::Identity(identity) => &identity.schemes,
        KnownAccessRef::Optional(optional) => &optional.schemes,
        KnownAccessRef::Public(_) => return Vec::new(),
    };

    schemes.iter().map(SchemeId::as_str).collect()
}

/// Compares the caller kinds of two operations.
fn compare_caller_kinds(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &Operation,
    after: &Operation,
) {
    let before_kinds: Vec<&str> = before.caller_kinds.iter().map(CallerKind::as_str).collect();
    let after_kinds: Vec<&str> = after.caller_kinds.iter().map(CallerKind::as_str).collect();

    compare_names(
        context,
        site,
        pointer,
        NameChange {
            kind: DiffKind::CallerKind,
            added_case: "added",
            removed_case: "removed",
        },
        &before_kinds,
        &after_kinds,
    );
}

/// The kind and the two cases a name list reports its additions and removals as.
#[derive(Debug, Clone, Copy)]
struct NameChange {
    kind: DiffKind,
    added_case: &'static str,
    removed_case: &'static str,
}

/// Compares two name lists: names added, names removed, then the order of the names both keep.
fn compare_names(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    change: NameChange,
    before: &[&str],
    after: &[&str],
) {
    for name in after.iter().filter(|name| !before.contains(name)) {
        emit_at(
            context,
            site,
            RawChange::new(change.kind, change.added_case, pointer.to_owned())
                .between(None, Some(text_value(name))),
        );
    }

    for name in before.iter().filter(|name| !after.contains(name)) {
        emit_at(
            context,
            site,
            RawChange::new(change.kind, change.removed_case, pointer.to_owned())
                .between(Some(text_value(name)), None),
        );
    }

    compare_kept_order(context, site, pointer, "values", before, after);
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

/// A requirement with its place key: its name and how many earlier ones carry that name.
#[derive(Debug, Serialize)]
struct RankedRequirement<'requirement> {
    requirement: &'requirement Requirement,
    key: String,
}

/// The name a requirement is matched by: its kind, then the right or the rule it names.
fn requirement_name(requirement: &Requirement) -> String {
    match KnownRequirementRef::try_from(requirement) {
        Ok(KnownRequirementRef::Right(right)) => format!("right\u{0}{}", right.right.as_str()),
        Ok(KnownRequirementRef::Rule(rule)) => format!("rule\u{0}{}", rule.rule.as_str()),
        Err(_) => requirement.tag().to_owned(),
    }
}

/// The requirements with their keys: the name, then the rank among the requirements of that name.
fn ranked_requirements(list: &[Requirement]) -> Vec<RankedRequirement<'_>> {
    let names: Vec<String> = list.iter().map(requirement_name).collect();

    list.iter()
        .zip(&names)
        .enumerate()
        .map(|(index, (requirement, name))| {
            let rank = names
                .iter()
                .take(index)
                .filter(|candidate| *candidate == name)
                .count();

            RankedRequirement {
                requirement,
                key: format!("{name}\u{0}{rank}"),
            }
        })
        .collect()
}

/// Compares the requirements of two operations by name and rank, then their order.
fn compare_requirements(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &[Requirement],
    after: &[Requirement],
) -> Result<(), DiffError> {
    if let Some(unknown) = before
        .iter()
        .chain(after)
        .find(|requirement| KnownRequirementRef::try_from(*requirement).is_err())
    {
        refuse_unknown_value(
            context,
            site,
            &pointer_join(pointer, &["kind"]),
            unknown.tag(),
        );

        return Ok(());
    }

    let before_ranked = ranked_requirements(before);
    let after_ranked = ranked_requirements(after);
    let label = |ranked: &RankedRequirement<'_>| {
        text_value(&requirement_name(ranked.requirement).replacen('\u{0}', " ", 1))
    };
    let comparison = KeyedListComparison {
        key_of: Box::new(|ranked: &RankedRequirement<'_>| Ok(ranked.key.clone())),
        added: Box::new(|context, entry_pointer, ranked| {
            emit_at(
                context,
                site,
                RawChange::new(DiffKind::Requirement, "added", entry_pointer.to_owned())
                    .between(None, Some(label(ranked))),
            );

            Ok(())
        }),
        removed: Box::new(|context, entry_pointer, ranked| {
            emit_at(
                context,
                site,
                RawChange::new(DiffKind::Requirement, "removed", entry_pointer.to_owned())
                    .between(Some(label(ranked)), None),
            );

            Ok(())
        }),
        kept: Box::new(|context, entry_pointer, before_entry, after_entry| {
            let definition = match KnownRequirementRef::try_from(after_entry.requirement) {
                Ok(KnownRequirementRef::Rule(_)) => IrDefinition::RuleRequirement,
                Ok(KnownRequirementRef::Right(_)) | Err(_) => IrDefinition::RightRequirement,
            };

            compare_members(
                context,
                site,
                definition,
                entry_pointer,
                Some(&object_members(before_entry.requirement)?),
                Some(&object_members(after_entry.requirement)?),
                &MemberComparisons::new(),
            )
        }),
    };

    compare_keyed_list(context, pointer, &before_ranked, &after_ranked, &comparison)?;

    let before_keys: Vec<&str> = before_ranked
        .iter()
        .map(|ranked| ranked.key.as_str())
        .collect();
    let after_keys: Vec<&str> = after_ranked
        .iter()
        .map(|ranked| ranked.key.as_str())
        .collect();

    compare_kept_order(
        context,
        site,
        pointer,
        "requires",
        &before_keys,
        &after_keys,
    );

    Ok(())
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

/// Compares the csrf protection of two operations: switched on or off, reworded, else by member.
fn compare_csrf(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: Option<&Csrf>,
    after: Option<&Csrf>,
) -> Result<(), DiffError> {
    if let Some(unknown) = [before, after]
        .into_iter()
        .flatten()
        .find(|csrf| KnownCsrfRef::try_from(*csrf).is_err())
    {
        refuse_unknown_value(
            context,
            site,
            &pointer_join(pointer, &["kind"]),
            unknown.tag(),
        );

        return Ok(());
    }

    let kind_of = |csrf: Option<&Csrf>| csrf.map(|found| text_value(found.tag()));
    let is_derived = |csrf: Option<&Csrf>| csrf.is_some_and(|found| found.tag() == "derived");
    let (before_on, after_on) = (is_derived(before), is_derived(after));

    if before_on != after_on {
        emit_at(
            context,
            site,
            RawChange::new(
                DiffKind::Csrf,
                if after_on { "added" } else { "removed" },
                pointer.to_owned(),
            )
            .between(kind_of(before), kind_of(after)),
        );

        return Ok(());
    }

    let (Some(before_csrf), Some(after_csrf)) = (before, after) else {
        emit_at(
            context,
            site,
            RawChange::new(DiffKind::Annotation, "csrf", pointer.to_owned())
                .between(kind_of(before), kind_of(after)),
        );

        return Ok(());
    };

    if before_csrf.tag() != after_csrf.tag() {
        emit_at(
            context,
            site,
            RawChange::new(DiffKind::Annotation, "csrf", pointer.to_owned())
                .between(kind_of(before), kind_of(after)),
        );

        return Ok(());
    }

    compare_members(
        context,
        site,
        if after_on {
            IrDefinition::DerivedCsrf
        } else {
            IrDefinition::ExemptCsrf
        },
        pointer,
        Some(&object_members(before_csrf)?),
        Some(&object_members(after_csrf)?),
        &MemberComparisons::new(),
    )
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;
    use crate::change_sink::{ChangeSink, NO_POSITION};
    use crate::sample_ir::sample_ir;
    use crate::walk_reach::ReachIndex;

    #[test]
    fn a_rank_change_names_the_optional_anonymous_cases_before_direction() {
        assert_eq!(
            rank_change_case(PUBLIC_RANK, OPTIONAL_ANONYMOUS_RANK),
            "principalOptionalAdded"
        );
        assert_eq!(
            rank_change_case(OPTIONAL_ANONYMOUS_RANK, PUBLIC_RANK),
            "principalOptionalRemoved"
        );
        assert_eq!(rank_change_case(PUBLIC_RANK, IDENTITY_RANK), "tightened");
        assert_eq!(
            rank_change_case(OPTIONAL_REJECT_RANK, OPTIONAL_ANONYMOUS_RANK),
            "loosened"
        );
    }

    fn field_right(direction: &str, right: &str) -> FieldRight {
        let text = format!(
            r#"{{"schema":"S","pointer":"/p","right":"{right}","direction":"{direction}","derivedFrom":{{"derivation":"x","from":[]}}}}"#
        );

        serde_json::from_str(&text).unwrap_or_else(|error| panic!("{text}: {error}"))
    }

    #[test]
    fn a_field_right_changes_at_its_direction_and_an_unknown_direction_refuses() {
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

        compare_field_rights(
            &mut context,
            &site,
            "/operations/0/fieldRights",
            &[field_right("input", "r1"), field_right("sideways", "r1")],
            &[field_right("input", "r2"), field_right("sideways", "r2")],
        )
        .unwrap_or_else(|error| panic!("{error}"));

        let changes = context.sink.sorted_changes();

        assert_eq!(changes.len(), 1, "changes {changes:?}");
        assert_eq!(
            context
                .sink
                .refusals()
                .first()
                .and_then(|refusal| refusal.member.clone()),
            Some("/operations/0/fieldRights/direction".to_owned())
        );
    }

    #[test]
    fn requirements_are_named_by_kind_and_target_and_ranked_by_repeats() {
        let right = |name: &str| -> Requirement {
            serde_json::from_value(serde_json::json!({"kind": "right", "right": name}))
                .unwrap_or_else(|error| panic!("{error}"))
        };
        let list = [right("a"), right("b"), right("a")];
        let keys: Vec<String> = ranked_requirements(&list)
            .into_iter()
            .map(|ranked| ranked.key)
            .collect();

        assert_eq!(
            keys,
            vec![
                "right\u{0}a\u{0}0".to_owned(),
                "right\u{0}b\u{0}0".to_owned(),
                "right\u{0}a\u{0}1".to_owned()
            ]
        );
    }
}
