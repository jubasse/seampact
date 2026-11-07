"""The boot variant a boot case starts the app with (`SEAMPACT_SUITE_BOOT_VARIANT`, ADR 0015 "Boot tests"); unset, the
app boots as configured. The `allow-listed-framework-route` variant starts the app built from the target's
`seampact.allow-listed.config.yaml`, the framework-route-check-off ones that of `seampact.route-check-off.config.yaml`,
and `_HOOK_CHECK_OFF_APP_VARIANTS` that of `seampact.hook-check-off.config.yaml`, whose `tasks` entry filters `health`
out."""

import os
from enum import StrEnum
from typing import Final

_VARIABLE: Final = "SEAMPACT_SUITE_BOOT_VARIANT"

MISMATCHED_MOUNT: Final = "/mounted"
"""The framework prefix the `mount-mismatch` variant serves the `tasks` api under; its entry states no mount."""

PATTERNED_ROUTE: Final = "/v1/patterned/one/two"
"""The framework route the `pattern-allow-listed-framework-route` variant serves, allow-listed by `/v1/patterned/**`."""


class BootVariant(StrEnum):
    MISSING_AUTHENTICATE_HOOK = "missing-authenticate-hook"
    MISSING_DECIDER = "missing-decider"
    MISSING_SCOPE_RESOLVER = "missing-scope-resolver"
    MISSING_HANDLER = "missing-handler"
    UNLISTED_FRAMEWORK_ROUTE = "unlisted-framework-route"
    ALLOW_LISTED_FRAMEWORK_ROUTE = "allow-listed-framework-route"
    PATTERN_ALLOW_LISTED_FRAMEWORK_ROUTE = "pattern-allow-listed-framework-route"
    FRAMEWORK_ROUTE_CHECK_OFF = "framework-route-check-off"
    FRAMEWORK_ROUTE_CHECK_OFF_MISSING_HOOK = "framework-route-check-off-missing-hook"
    HOOK_CHECK_OFF = "hook-check-off"
    HOOK_CHECK_OFF_UNLISTED_ROUTE = "hook-check-off-unlisted-route"
    FILTERED_OUT_HANDLER = "filtered-out-handler"
    MOUNT_MISMATCH = "mount-mismatch"


_HOOK_CHECK_OFF_APP_VARIANTS: Final = (
    BootVariant.HOOK_CHECK_OFF,
    BootVariant.HOOK_CHECK_OFF_UNLISTED_ROUTE,
    BootVariant.FILTERED_OUT_HANDLER,
)


def current_boot_variant() -> BootVariant | None:
    variant = os.environ.get(_VARIABLE, "")

    if variant == "":
        return None

    try:
        return BootVariant(variant)
    except ValueError:
        names = ", ".join(BootVariant)
        raise ValueError(f"{_VARIABLE}='{variant}' names no boot variant; use one of {names}") from None


def serves_unlisted_route() -> bool:
    """Whether the app serves `GET /v1/unlisted`: under each variant that checks that route."""
    return current_boot_variant() in (
        BootVariant.UNLISTED_FRAMEWORK_ROUTE,
        BootVariant.ALLOW_LISTED_FRAMEWORK_ROUTE,
        BootVariant.FRAMEWORK_ROUTE_CHECK_OFF,
        BootVariant.HOOK_CHECK_OFF_UNLISTED_ROUTE,
    )


def serves_patterned_route() -> bool:
    return current_boot_variant() is BootVariant.PATTERN_ALLOW_LISTED_FRAMEWORK_ROUTE


def mounts_under_mismatched_prefix() -> bool:
    """Whether the app serves the `tasks` api under `MISMATCHED_MOUNT`."""
    return current_boot_variant() is BootVariant.MOUNT_MISMATCH


def leaves_out_authenticate_hook() -> bool:
    """Whether the app registers no authenticate hook for the identity `user`."""
    return current_boot_variant() in (
        BootVariant.MISSING_AUTHENTICATE_HOOK,
        BootVariant.FRAMEWORK_ROUTE_CHECK_OFF_MISSING_HOOK,
        BootVariant.HOOK_CHECK_OFF,
    )


def leaves_out_health_handler() -> bool:
    """Whether the app binds no handler for the `health` operation: missing, or filtered out of the generated code."""
    variant = current_boot_variant()

    return variant is BootVariant.MISSING_HANDLER or variant in _HOOK_CHECK_OFF_APP_VARIANTS
