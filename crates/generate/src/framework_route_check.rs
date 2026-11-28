//! The boot check switches of an entry: the keys its target does not read, and the framework-route
//! check its `artefacts` and `frameworkRoutes` ask for.

use seampact_cli_config::{
    CliProblem, FrameworkRouteEntry, TargetEntrySettings, entry_where, framework_routes_switch_in,
    hook_check_switch_of, is_framework_route_check_strict, is_framework_route_check_switched_off,
    located_problem,
};
use seampact_target::{
    FrameworkRouteAllowance, FrameworkRouteCheck, FrameworkRouteScope, Generator, RouteCheckOrigin,
    TunableBootCheck,
};

const FRAMEWORK_ROUTES_KEY: &str = "frameworkRoutes";
const FRAMEWORK_ROUTES_SWITCH_KEY: &str = "artefacts.bootCheck.frameworkRoutes";
const HOOKS_SWITCH_KEY: &str = "artefacts.bootCheck.hooks";
const MOUNT_KEY: &str = "mount";

/// One problem for each key of `entry` that tunes a boot check its target does not generate.
#[must_use]
pub fn unread_framework_route_key_problems(
    entry: &TargetEntrySettings,
    target: &dyn Generator,
) -> Vec<CliProblem> {
    let generates = |check: TunableBootCheck| target.metadata().boot_checks.contains(&check);
    let mut unread_keys: Vec<&str> = Vec::new();

    if !generates(TunableBootCheck::FrameworkRoutes) {
        if entry.framework_routes.is_some() {
            unread_keys.push(FRAMEWORK_ROUTES_KEY);
        }

        if framework_routes_switch_in(entry.artefacts.as_ref()).is_some() {
            unread_keys.push(FRAMEWORK_ROUTES_SWITCH_KEY);
        }

        // A target that checks the app's routes is one that serves the contract's: it alone reads `mount`.
        if entry.mount.is_some() {
            unread_keys.push(MOUNT_KEY);
        }
    }

    if !generates(TunableBootCheck::Hooks)
        && hook_check_switch_of(entry.artefacts.as_ref()).is_some()
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

fn allowance_of(route: &FrameworkRouteEntry) -> FrameworkRouteAllowance {
    FrameworkRouteAllowance {
        method: route.method.map(|method| method.as_str().to_owned()),
        path: route.path.clone(),
        reason: route.reason.clone(),
    }
}

/// The framework-route check `entry` asks for: off, or on with its allowances and scope.
#[must_use]
pub(crate) fn framework_route_check_of(entry: &TargetEntrySettings) -> FrameworkRouteCheck {
    if is_framework_route_check_switched_off(entry.artefacts.as_ref()) {
        return FrameworkRouteCheck::Off;
    }

    let origin = if framework_routes_switch_in(entry.artefacts.as_ref()).is_some() {
        RouteCheckOrigin::Written
    } else {
        RouteCheckOrigin::Default
    };
    let scope = if is_framework_route_check_strict(entry.artefacts.as_ref()) {
        FrameworkRouteScope::Strict
    } else {
        FrameworkRouteScope::Contract
    };

    FrameworkRouteCheck::On {
        allowed: entry
            .framework_routes
            .iter()
            .flatten()
            .map(allowance_of)
            .collect(),
        scope,
        origin,
    }
}
