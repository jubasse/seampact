//! The boot check switches of a target entry's `artefacts`.

use indexmap::IndexMap;
use seampact_js::js_key_order;
use seampact_json::{JsonValue, object_of};
use seampact_target::{ArtefactDeclaration, ArtefactDefault, ArtefactSet, Generator, MissingNeed};

use crate::artefact_switch::{
    ArtefactSwitch, ArtefactSwitches, FrameworkRoutesSwitch, HookBootCheckLevel,
};
use crate::target_entry_settings::TargetEntrySettings;
use crate::{CliConfigError, CliProblem, entry_where, located_problem};

const BOOT_CHECK_ARTEFACT: &str = "bootCheck";
const NATIVE_DOCS_ARTEFACT: &str = "nativeDocs";
const FRAMEWORK_ROUTES_SWITCH: &str = "frameworkRoutes";

/// The `bootCheck.frameworkRoutes` switch an entry writes in `bootCheck`'s object form.
pub(crate) fn framework_routes_switch_of(artefacts: Option<&JsonValue>) -> Option<&JsonValue> {
    let boot_check = object_of(artefacts).and_then(|object| object.get(BOOT_CHECK_ARTEFACT));

    object_of(boot_check).and_then(|object| object.get(FRAMEWORK_ROUTES_SWITCH))
}

/// Off when the entry switches the whole boot check off, or its framework-route check alone.
pub(crate) fn is_framework_route_check_off(artefacts: Option<&JsonValue>) -> bool {
    let boot_check = object_of(artefacts).and_then(|object| object.get(BOOT_CHECK_ARTEFACT));

    boot_check == Some(&JsonValue::Bool(false))
        || framework_routes_switch_of(artefacts) == Some(&JsonValue::Bool(false))
}

/// The artefacts an entry generates, or the problems that refuse its switches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArtefactSelection {
    /// The artefacts switched on, in the target's declaration order.
    Selected(ArtefactSet),
    /// The switches the target does not allow.
    Refused(Vec<CliProblem>),
}

/// The `bootCheck.hooks` level an entry writes in `bootCheck`'s object form.
#[must_use]
pub fn hook_check_switch_of(artefacts: Option<&ArtefactSwitches>) -> Option<HookBootCheckLevel> {
    match artefacts?.0.get(BOOT_CHECK_ARTEFACT)? {
        ArtefactSwitch::BootCheck(switches) => switches.hooks,
        ArtefactSwitch::Flag(_) => None,
    }
}

/// The hook check level of an entry: `error` unless it writes another.
#[must_use]
pub fn hook_check_level_of(artefacts: Option<&ArtefactSwitches>) -> HookBootCheckLevel {
    hook_check_switch_of(artefacts).unwrap_or(HookBootCheckLevel::Error)
}

/// Strict when the entry asks every app route checked, not only those under the contract's base
/// paths.
#[must_use]
pub fn is_framework_route_check_strict(artefacts: Option<&ArtefactSwitches>) -> bool {
    let Some(ArtefactSwitch::BootCheck(switches)) =
        artefacts.and_then(|switches| switches.0.get(BOOT_CHECK_ARTEFACT))
    else {
        return false;
    };

    matches!(
        switches.framework_routes,
        Some(FrameworkRoutesSwitch::Strict(_))
    )
}

/// The artefacts of `entry` on `target`: each declared artefact at its default unless the entry's
/// `artefacts` switches it.
///
/// The artefacts are in the target's declaration order. A target that declares tunable boot
/// checks without a `bootCheck` artefact takes `bootCheck` as a boolean too, read by the boot
/// check itself.
///
/// # Errors
///
/// Never fails today; the result keeps the error of the signature the callers were written to.
pub fn select_artefacts(
    entry: &TargetEntrySettings,
    target: &dyn Generator,
) -> Result<ArtefactSelection, CliConfigError> {
    let metadata = target.metadata();
    let declared = metadata.artefacts;
    let switches = boolean_switches_of(entry.artefacts.as_ref());
    let unknown =
        unknown_switch_problems(entry, declared, !metadata.boot_checks.is_empty(), &switches);

    if !unknown.is_empty() {
        return Ok(ArtefactSelection::Refused(unknown));
    }

    let mut artefacts: Vec<&str> = declared
        .iter()
        .filter(|artefact| {
            switches
                .get(artefact.id)
                .copied()
                .unwrap_or(artefact.default == ArtefactDefault::On)
        })
        .map(|artefact| artefact.id)
        .collect();

    drop_unwritten_without_needs(declared, &switches, &mut artefacts);

    if !declared.is_empty() && artefacts.is_empty() {
        return Ok(ArtefactSelection::Refused(vec![no_artefact_problem(
            entry, declared,
        )]));
    }

    let needed = needed_artefact_problems(entry, declared, &artefacts);

    if !needed.is_empty() {
        return Ok(ArtefactSelection::Refused(needed));
    }

    Ok(ArtefactSelection::Selected(ArtefactSet::new(
        artefacts.into_iter().map(str::to_owned),
    )))
}

/// The switches written as a boolean, in JavaScript key order.
fn boolean_switches_of(artefacts: Option<&ArtefactSwitches>) -> IndexMap<&str, bool> {
    let Some(artefacts) = artefacts else {
        return IndexMap::new();
    };

    js_key_order(artefacts.0.iter())
        .filter_map(|(id, switch)| match switch {
            ArtefactSwitch::Flag(on) => Some((id.as_str(), *on)),
            ArtefactSwitch::BootCheck(_) => None,
        })
        .collect()
}

fn unknown_switch_problems(
    entry: &TargetEntrySettings,
    declared: &[ArtefactDeclaration],
    tunes_boot_checks: bool,
    switches: &IndexMap<&str, bool>,
) -> Vec<CliProblem> {
    let declared_ids: Vec<&str> = declared.iter().map(|artefact| artefact.id).collect();

    switches
        .keys()
        .filter(|id| !declared_ids.contains(id))
        .filter(|id| !(**id == BOOT_CHECK_ARTEFACT && tunes_boot_checks))
        .map(|id| {
            located_problem(
                "config.artefacts.unknown",
                format!(
                    "The target '{}' declares no artefact '{id}'; it declares {}.",
                    entry.use_name,
                    quoted_list(&declared_ids)
                ),
                &unknown_switch_fix(id),
                entry_where(&entry.id, None),
            )
        })
        .collect()
}

fn unknown_switch_fix(id: &str) -> String {
    if id == NATIVE_DOCS_ARTEFACT {
        return "Remove 'nativeDocs' from the entry's `artefacts`: this target completes no framework-native document, and the seampact OpenAPI document `generate` writes (`openapi/<api>.yaml` unless the app's `openapi` key places it) describes the api.".to_owned();
    }

    format!(
        "Remove '{id}' from the entry's `artefacts`, or switch one of the artefacts the target declares."
    )
}

fn drop_unwritten_without_needs(
    declared: &[ArtefactDeclaration],
    switches: &IndexMap<&str, bool>,
    artefacts: &mut Vec<&str>,
) {
    for artefact in declared {
        if artefact.missing_need != MissingNeed::LeaveOff || switches.contains_key(artefact.id) {
            continue;
        }

        if artefact.needs.iter().any(|need| !artefacts.contains(need)) {
            artefacts.retain(|id| *id != artefact.id);
        }
    }
}

fn needed_artefact_problems(
    entry: &TargetEntrySettings,
    declared: &[ArtefactDeclaration],
    artefacts: &[&str],
) -> Vec<CliProblem> {
    declared
        .iter()
        .filter(|artefact| artefacts.contains(&artefact.id))
        .flat_map(|artefact| {
            artefact
                .needs
                .iter()
                .filter(|need| !artefacts.contains(need))
                .map(|need| {
                    located_problem(
                        "config.artefacts.needed",
                        format!(
                            "The artefact '{}' of the target '{}' needs '{need}', which the entry leaves off.",
                            artefact.id, entry.use_name
                        ),
                        &format!("Switch '{need}' on, or switch '{}' off too.", artefact.id),
                        entry_where(&entry.id, None),
                    )
                })
        })
        .collect()
}

fn no_artefact_problem(
    entry: &TargetEntrySettings,
    declared: &[ArtefactDeclaration],
) -> CliProblem {
    let declared_ids: Vec<&str> = declared.iter().map(|artefact| artefact.id).collect();

    located_problem(
        "config.artefacts.none",
        format!(
            "The entry leaves off every artefact the target '{}' declares ({}), so it would generate nothing.",
            entry.use_name,
            quoted_list(&declared_ids)
        ),
        "Remove the entry from `targets`, or switch one of its artefacts on.",
        entry_where(&entry.id, None),
    )
}

/// The ids in single quotes, joined by a comma and a space.
pub(crate) fn quoted_list(ids: &[&str]) -> String {
    let quoted: Vec<String> = ids.iter().map(|id| format!("'{id}'")).collect();

    quoted.join(", ")
}
