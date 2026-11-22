//! The boot check switches of a target entry's `artefacts`.

use seampact_json::JsonValue;

use crate::json_access::record;

const BOOT_CHECK_ARTEFACT: &str = "bootCheck";
const FRAMEWORK_ROUTES_SWITCH: &str = "frameworkRoutes";

/// The `bootCheck.frameworkRoutes` switch an entry writes in `bootCheck`'s object form.
pub(crate) fn framework_routes_switch_of(artefacts: Option<&JsonValue>) -> Option<&JsonValue> {
    let boot_check = record(artefacts).and_then(|object| object.get(BOOT_CHECK_ARTEFACT));

    record(boot_check).and_then(|object| object.get(FRAMEWORK_ROUTES_SWITCH))
}

/// Off when the entry switches the whole boot check off, or its framework-route check alone.
pub(crate) fn is_framework_route_check_off(artefacts: Option<&JsonValue>) -> bool {
    let boot_check = record(artefacts).and_then(|object| object.get(BOOT_CHECK_ARTEFACT));

    boot_check == Some(&JsonValue::Bool(false))
        || framework_routes_switch_of(artefacts) == Some(&JsonValue::Bool(false))
}
