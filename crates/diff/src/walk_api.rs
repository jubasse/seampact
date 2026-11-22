//! The comparison of the api member and of the packs.

use std::collections::{HashMap, HashSet};

use seampact_diff_table::{DiffKind, DiffPosition, IrDefinition};
use seampact_ir::{Api, ContractIr, PackRef};

use crate::DiffError;
use crate::change_sink::{ChangeReach, ElementOrigin, NO_POSITION, RawChange};
use crate::not_ported::not_ported_yet;
use crate::walk_context::{ChangeSite, MemberComparisons, WalkContext, compare_members, emit_at};
use crate::walk_json::{object_members, text_value};
use crate::walk_maturity::compare_maturity_level;

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

/// Compares the wire member of the two apis.
///
/// # Errors
///
/// Not ported yet.
fn compare_wire(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: &Api,
    _after: &Api,
    _common_operations: &[String],
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareWire"))
}

/// Compares the surfaces of the two apis.
///
/// # Errors
///
/// Not ported yet.
fn compare_surfaces(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: &Api,
    _after: &Api,
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareSurfaces"))
}

/// Compares the two lists of packs.
///
/// # Errors
///
/// Not ported yet.
pub(crate) fn compare_packs(
    _context: &mut WalkContext<'_>,
    _before: &[PackRef],
    _after: &[PackRef],
) -> Result<(), DiffError> {
    Err(not_ported_yet("comparePacks"))
}
