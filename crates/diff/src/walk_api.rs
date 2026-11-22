//! The comparison of the api member and of the packs.

use std::collections::{HashMap, HashSet};

use seampact_diff_table::{DiffKind, DiffPosition, IrDefinition};
use seampact_ir::{Api, ContractIr, PackRef, Surface, SurfaceId};
use seampact_js::cmp_utf16;
use seampact_json::JsonValue;

use crate::DiffError;
use crate::change_sink::{ChangeReach, ElementOrigin, NO_POSITION, RawChange};
use crate::walk_context::{
    ChangeSite, MemberComparisons, WalkContext, compare_kept_order, compare_members, emit_at,
};
use crate::walk_json::{object_members, pointer_join, text_value};
use crate::walk_maturity::compare_maturity_level;
use crate::walk_reach::{INT64_REACH_KEY, OUTPUT_ENUMS_REACH_KEY, common_reaches};

/// The names of the packs whose version differs between the two sides, or that only one has.
pub(crate) fn changed_pack_names(before: &[PackRef], after: &[PackRef]) -> HashSet<String> {
    let versions = |packs: &'_ [PackRef]| -> HashMap<String, String> {
        packs
            .iter()
            .map(|pack| (pack.name.clone(), pack.version.clone()))
            .collect()
    };
    let before_versions = versions(before);
    let after_versions = versions(after);

    before_versions
        .keys()
        .chain(after_versions.keys())
        .filter(|name| before_versions.get(*name) != after_versions.get(*name))
        .cloned()
        .collect()
}

/// The JSON Pointer of the api member.
const API_POINTER: &str = "/api";

/// Compares the api member of the two IRs.
pub(crate) fn compare_api(context: &mut WalkContext<'_>) -> Result<(), DiffError> {
    let (before_ir, after_ir) = (context.before, context.after);
    let (before, after) = (&before_ir.api, &after_ir.api);
    let site = ChangeSite {
        reaches: &NO_POSITION,
        origin: Some(ElementOrigin::from(&after.origin)),
    };
    let common_operations = common_operation_ids(before_ir, after_ir);
    let path_version_reaches = vec![ChangeReach {
        position: DiffPosition::None,
        operations: operations_following_path_version(before_ir, after_ir),
        facts: Vec::new(),
    }];
    let path_version_site = ChangeSite {
        reaches: &path_version_reaches,
        origin: site.origin.clone(),
    };
    let mut comparisons = MemberComparisons::new();

    comparisons.insert("id", Box::new(|_context, _pointer, _before, _after| Ok(())));
    comparisons.insert(
        "version",
        Box::new(|_context, _pointer, _before, _after| Ok(())),
    );
    insert_path_version_comparison(&mut comparisons, &site, &path_version_site, before, after);
    comparisons.insert(
        "maturity",
        Box::new(|context, pointer, _before_value, _after_value| {
            compare_maturity_level(context, &site, pointer, &before.maturity, &after.maturity);

            Ok(())
        }),
    );
    insert_compat_comparison(&mut comparisons, &site, before, after);
    comparisons.insert(
        "wire",
        Box::new(|context, pointer, _before_value, _after_value| {
            compare_wire(context, &site, pointer, before, after, &common_operations)
        }),
    );
    comparisons.insert(
        "surfaces",
        Box::new(|context, pointer, _before_value, _after_value| {
            compare_surfaces(context, &site, pointer, before, after)
        }),
    );

    compare_members(
        context,
        &site,
        IrDefinition::Api,
        API_POINTER,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}

fn insert_path_version_comparison<'comparison>(
    comparisons: &mut MemberComparisons<'comparison>,
    site: &'comparison ChangeSite<'_>,
    path_version_site: &'comparison ChangeSite<'_>,
    before: &'comparison Api,
    after: &'comparison Api,
) {
    comparisons.insert(
        "pathVersion",
        Box::new(|context, pointer, _before_value, _after_value| {
            let mut value_comparisons = MemberComparisons::new();

            value_comparisons.insert(
                "value",
                Box::new(|context, value_pointer, _before_value, _after_value| {
                    emit_at(
                        context,
                        path_version_site,
                        RawChange::new(
                            DiffKind::OperationRoute,
                            "pathVersion",
                            value_pointer.to_owned(),
                        )
                        .between(
                            Some(text_value(before.path_version.value.as_str())),
                            Some(text_value(after.path_version.value.as_str())),
                        ),
                    );

                    Ok(())
                }),
            );

            compare_members(
                context,
                site,
                IrDefinition::PathVersion,
                pointer,
                Some(&object_members(&before.path_version)?),
                Some(&object_members(&after.path_version)?),
                &value_comparisons,
            )
        }),
    );
}

fn insert_compat_comparison<'comparison>(
    comparisons: &mut MemberComparisons<'comparison>,
    site: &'comparison ChangeSite<'_>,
    before: &'comparison Api,
    after: &'comparison Api,
) {
    comparisons.insert(
        "compat",
        Box::new(|context, pointer, _before_value, _after_value| {
            let mut policy_comparisons = MemberComparisons::new();

            policy_comparisons.insert(
                "policy",
                Box::new(|context, policy_pointer, _before_value, _after_value| {
                    emit_at(
                        context,
                        site,
                        RawChange::new(
                            DiffKind::CompatPolicy,
                            "changed",
                            policy_pointer.to_owned(),
                        )
                        .between(
                            Some(text_value(before.compat.policy.as_str())),
                            Some(text_value(after.compat.policy.as_str())),
                        ),
                    );

                    Ok(())
                }),
            );

            compare_members(
                context,
                site,
                IrDefinition::Compat,
                pointer,
                Some(&object_members(&before.compat)?),
                Some(&object_members(&after.compat)?),
                &policy_comparisons,
            )
        }),
    );
}

/// The ids of the operations both IRs hold, in the order of `after`.
fn common_operation_ids(before: &ContractIr, after: &ContractIr) -> Vec<String> {
    let before_ids: HashSet<&str> = before
        .operations
        .iter()
        .map(|operation| operation.id.as_str())
        .collect();

    after
        .operations
        .iter()
        .map(|operation| operation.id.as_str())
        .filter(|id| before_ids.contains(id))
        .map(str::to_owned)
        .collect()
}

/// The ids of the operations both IRs hold whose surface follows the api's path version.
fn operations_following_path_version(before: &ContractIr, after: &ContractIr) -> Vec<String> {
    let before_ids: HashSet<&str> = before
        .operations
        .iter()
        .filter(|operation| surface_follows_path_version(before, operation.surface.as_str()))
        .map(|operation| operation.id.as_str())
        .collect();

    after
        .operations
        .iter()
        .filter(|operation| surface_follows_path_version(after, operation.surface.as_str()))
        .map(|operation| operation.id.as_str())
        .filter(|id| before_ids.contains(id))
        .map(str::to_owned)
        .collect()
}

fn surface_follows_path_version(ir: &ContractIr, surface_id: &str) -> bool {
    ir.api
        .surfaces
        .get(surface_id)
        .is_some_and(|surface| surface.path_version == ir.api.path_version.value)
}

/// A change of one wire form: a type change at the uses that reach it, else an annotation.
fn emit_wire_change(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    wire_case: &str,
    reaches: &[ChangeReach],
    values: (Option<&JsonValue>, Option<&JsonValue>),
) {
    let used = reaches.iter().any(|reach| !reach.operations.is_empty());
    let (kind, case_name) = if used {
        (DiffKind::TypeChanged, wire_case.to_owned())
    } else {
        (DiffKind::Annotation, format!("wire.{wire_case}"))
    };
    let used_site = ChangeSite {
        reaches: if used { reaches } else { &NO_POSITION },
        origin: site.origin.clone(),
    };

    emit_at(
        context,
        &used_site,
        RawChange {
            kind,
            case_name,
            pointer: pointer.to_owned(),
            before: values.0.cloned(),
            after: values.1.cloned(),
            origin: None,
            facts: Vec::new(),
        },
    );
}

/// Compares the wire member of the two apis; each form changes at the uses that reach it.
fn compare_wire(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &Api,
    after: &Api,
    common_operations: &[String],
) -> Result<(), DiffError> {
    // Every response may carry a URL the target writes ($self, the paging roles, the successor link).
    let output_of_every_operation = [ChangeReach {
        position: DiffPosition::Output,
        operations: common_operations.to_vec(),
        facts: Vec::new(),
    }];
    let mut comparisons = MemberComparisons::new();

    comparisons.insert(
        "int64",
        Box::new(|context, member_pointer, before_value, after_value| {
            let reaches =
                common_reaches(&context.before_reach, &context.after_reach, INT64_REACH_KEY);

            emit_wire_change(
                context,
                site,
                member_pointer,
                "int64Wire",
                &reaches,
                (before_value, after_value),
            );

            Ok(())
        }),
    );
    comparisons.insert(
        "outputEnums",
        Box::new(|context, member_pointer, before_value, after_value| {
            let reaches: Vec<ChangeReach> = common_reaches(
                &context.before_reach,
                &context.after_reach,
                OUTPUT_ENUMS_REACH_KEY,
            )
            .into_iter()
            .filter(|reach| reach.position == DiffPosition::Output)
            .collect();

            emit_wire_change(
                context,
                site,
                member_pointer,
                "outputEnums",
                &reaches,
                (before_value, after_value),
            );

            Ok(())
        }),
    );
    comparisons.insert(
        "urls",
        Box::new(|context, member_pointer, before_value, after_value| {
            emit_wire_change(
                context,
                site,
                member_pointer,
                "urls",
                &output_of_every_operation,
                (before_value, after_value),
            );

            Ok(())
        }),
    );

    compare_members(
        context,
        site,
        IrDefinition::ApiWire,
        pointer,
        Some(&object_members(&before.wire)?),
        Some(&object_members(&after.wire)?),
        &comparisons,
    )
}

/// Compares the surfaces of the two apis by id, in UTF-16 order of the ids.
fn compare_surfaces(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &Api,
    after: &Api,
) -> Result<(), DiffError> {
    let mut surface_ids: Vec<&str> = before
        .surfaces
        .keys()
        .chain(after.surfaces.keys())
        .map(SurfaceId::as_str)
        .collect();

    surface_ids.sort_by(|left, right| cmp_utf16(left, right));
    surface_ids.dedup();

    for id in surface_ids {
        let surface_pointer = pointer_join(pointer, &[id]);

        // A surface holds no wire of its own: its operations are added or removed with it.
        let (Some(before_surface), Some(after_surface)) =
            (before.surfaces.get(id), after.surfaces.get(id))
        else {
            emit_at(
                context,
                site,
                RawChange::new(DiffKind::Annotation, "surfaces", surface_pointer),
            );

            continue;
        };

        compare_surface(
            context,
            site,
            &surface_pointer,
            id,
            (before_surface, after_surface),
        )?;
    }

    Ok(())
}

/// Compares one surface kept by both apis: its route members change the operations it holds.
fn compare_surface(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    id: &str,
    surfaces: (&Surface, &Surface),
) -> Result<(), DiffError> {
    let (before, after) = surfaces;
    let before_ids: HashSet<&str> = context
        .before
        .operations
        .iter()
        .filter(|operation| operation.surface.as_str() == id)
        .map(|operation| operation.id.as_str())
        .collect();
    let operations: Vec<String> = context
        .after
        .operations
        .iter()
        .filter(|operation| operation.surface.as_str() == id)
        .filter(|operation| before_ids.contains(operation.id.as_str()))
        .map(|operation| operation.id.as_str().to_owned())
        .collect();
    let origin = Some(ElementOrigin::from(&after.origin));
    let surface_reaches = [ChangeReach {
        position: DiffPosition::None,
        operations,
        facts: Vec::new(),
    }];
    let surface_site = ChangeSite {
        reaches: &surface_reaches,
        origin: origin.clone(),
    };
    let mut comparisons = MemberComparisons::new();

    for (member, route_case) in [("prefix", "surfacePrefix"), ("pathVersion", "pathVersion")] {
        comparisons.insert(
            member,
            Box::new(|context, member_pointer, before_value, after_value| {
                emit_at(
                    context,
                    &surface_site,
                    RawChange::new(
                        DiffKind::OperationRoute,
                        route_case,
                        member_pointer.to_owned(),
                    )
                    .between(before_value.cloned(), after_value.cloned()),
                );

                Ok(())
            }),
        );
    }

    compare_members(
        context,
        &ChangeSite {
            reaches: site.reaches,
            origin,
        },
        IrDefinition::Surface,
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}

/// Compares the two lists of packs: added and removed by name, a version moved, then the order.
pub(crate) fn compare_packs(context: &mut WalkContext<'_>, before: &[PackRef], after: &[PackRef]) {
    let site = ChangeSite {
        reaches: &NO_POSITION,
        origin: None,
    };

    for (index, pack) in after.iter().enumerate() {
        let pointer = pointer_join("", &["packs", &index.to_string()]);
        let Some(before_pack) = before.iter().find(|candidate| candidate.name == pack.name) else {
            emit_at(
                context,
                &site,
                RawChange::new(DiffKind::PackUpgraded, "added", pointer)
                    .between(None, Some(text_value(&pack.name))),
            );

            continue;
        };

        if before_pack.version != pack.version {
            emit_at(
                context,
                &site,
                RawChange::new(DiffKind::PackUpgraded, "version", pointer).between(
                    Some(text_value(&before_pack.version)),
                    Some(text_value(&pack.version)),
                ),
            );
        }
    }

    for (index, pack) in before.iter().enumerate() {
        if after.iter().any(|candidate| candidate.name == pack.name) {
            continue;
        }

        emit_at(
            context,
            &site,
            RawChange::new(
                DiffKind::PackUpgraded,
                "removed",
                pointer_join("", &["packs", &index.to_string()]),
            )
            .between(Some(text_value(&pack.name)), None),
        );
    }

    let before_names: Vec<&str> = before.iter().map(|pack| pack.name.as_str()).collect();
    let after_names: Vec<&str> = after.iter().map(|pack| pack.name.as_str()).collect();

    compare_kept_order(
        context,
        &site,
        "/packs",
        "packs",
        &before_names,
        &after_names,
    );
}
