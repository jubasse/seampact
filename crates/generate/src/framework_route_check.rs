//! The boot check switches of an entry: the keys its target does not read, and the framework-route
//! check its `artefacts` and `frameworkRoutes` ask for.

use seampact_cli_config::{
    ArtefactSwitch, BootCheckSwitches, CliProblem, FrameworkRouteEntry, FrameworkRoutesSwitch,
    HttpMethod, TargetEntrySettings, entry_where, located_problem,
};
use seampact_target::{
    FrameworkRouteAllowance, FrameworkRouteCheck, FrameworkRouteScope, Generator, RouteCheckOrigin,
    TunableBootCheck,
};

const BOOT_CHECK_ARTEFACT: &str = "bootCheck";
const FRAMEWORK_ROUTES_KEY: &str = "frameworkRoutes";
const FRAMEWORK_ROUTES_SWITCH_KEY: &str = "artefacts.bootCheck.frameworkRoutes";
const HOOKS_SWITCH_KEY: &str = "artefacts.bootCheck.hooks";
const MOUNT_KEY: &str = "mount";

fn boot_check_object(entry: &TargetEntrySettings) -> Option<&BootCheckSwitches> {
    match entry.artefacts.as_ref()?.0.get(BOOT_CHECK_ARTEFACT)? {
        ArtefactSwitch::BootCheck(switches) => Some(switches),
        ArtefactSwitch::Flag(_) => None,
    }
}

fn framework_routes_switch_of(entry: &TargetEntrySettings) -> Option<FrameworkRoutesSwitch> {
    boot_check_object(entry)?.framework_routes
}

fn is_framework_route_check_off(entry: &TargetEntrySettings) -> bool {
    let boot_check_off = entry
        .artefacts
        .as_ref()
        .and_then(|switches| switches.0.get(BOOT_CHECK_ARTEFACT))
        == Some(&ArtefactSwitch::Flag(false));

    boot_check_off || framework_routes_switch_of(entry) == Some(FrameworkRoutesSwitch::Flag(false))
}

fn is_framework_route_check_strict(entry: &TargetEntrySettings) -> bool {
    matches!(
        framework_routes_switch_of(entry),
        Some(FrameworkRoutesSwitch::Strict(_))
    )
}

/// One problem for each key of `entry` that tunes a boot check its target does not generate.
#[must_use]
pub fn unread_framework_route_key_problems(
    entry: &TargetEntrySettings,
    target: &dyn Generator,
) -> Vec<CliProblem> {
    let generates = |check: TunableBootCheck| target.metadata().boot_checks.contains(&check);
    let mut unread_keys: Vec<&str> = Vec::new();

    if !generates(TunableBootCheck::FrameworkRoutes) {
        if !entry.framework_routes.is_empty() {
            unread_keys.push(FRAMEWORK_ROUTES_KEY);
        }

        if framework_routes_switch_of(entry).is_some() {
            unread_keys.push(FRAMEWORK_ROUTES_SWITCH_KEY);
        }

        // A target that checks the app's routes is one that serves the contract's: it alone reads `mount`.
        if entry.mount.is_some() {
            unread_keys.push(MOUNT_KEY);
        }
    }

    if !generates(TunableBootCheck::Hooks)
        && boot_check_object(entry).is_some_and(|each| each.hooks.is_some())
    {
        unread_keys.push(HOOKS_SWITCH_KEY);
    }

    unread_keys
        .into_iter()
        .map(|key| {
            located_problem(
                "config.key.unsupported",
                format!(
                    "The target '{}' generates no boot check that reads '{key}'.",
                    entry.use_name
                ),
                &format!("Remove '{key}' from the entry; it belongs to a server target's entry."),
                entry_where(&entry.id, None),
            )
        })
        .collect()
}

const fn method_text(method: HttpMethod) -> &'static str {
    match method {
        HttpMethod::Get => "GET",
        HttpMethod::Head => "HEAD",
        HttpMethod::Post => "POST",
        HttpMethod::Put => "PUT",
        HttpMethod::Patch => "PATCH",
        HttpMethod::Delete => "DELETE",
        HttpMethod::Options => "OPTIONS",
    }
}

fn allowance_of(route: &FrameworkRouteEntry) -> FrameworkRouteAllowance {
    FrameworkRouteAllowance {
        method: route.method.map(|method| method_text(method).to_owned()),
        path: route.path.clone(),
        reason: route.reason.clone(),
    }
}

/// The framework-route check `entry` asks for: off, or on with its allowances and scope.
#[must_use]
#[expect(dead_code, reason = "called by generate_api, brief 2")]
pub(crate) fn framework_route_check_of(entry: &TargetEntrySettings) -> FrameworkRouteCheck {
    if is_framework_route_check_off(entry) {
        return FrameworkRouteCheck::Off;
    }

    let origin = if framework_routes_switch_of(entry).is_some() {
        RouteCheckOrigin::Written
    } else {
        RouteCheckOrigin::Default
    };
    let scope = if is_framework_route_check_strict(entry) {
        FrameworkRouteScope::Strict
    } else {
        FrameworkRouteScope::Contract
    };

    FrameworkRouteCheck::On {
        allowed: entry.framework_routes.iter().map(allowance_of).collect(),
        scope,
        origin,
    }
}
