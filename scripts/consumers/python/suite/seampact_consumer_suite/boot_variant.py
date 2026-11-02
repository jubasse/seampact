"""The boot variant a boot case starts the app with (`SEAMPACT_SUITE_BOOT_VARIANT`, ADR 0015 "Boot tests"); unset, the
app boots as configured. The allow-listed variant is the configured app built from its allow-listed config."""

import os
from enum import StrEnum
from typing import Final

_VARIABLE: Final = "SEAMPACT_SUITE_BOOT_VARIANT"


class BootVariant(StrEnum):
    MISSING_AUTHENTICATE_HOOK = "missing-authenticate-hook"
    MISSING_DECIDER = "missing-decider"
    MISSING_SCOPE_RESOLVER = "missing-scope-resolver"
    MISSING_HANDLER = "missing-handler"
    UNLISTED_FRAMEWORK_ROUTE = "unlisted-framework-route"
    ALLOW_LISTED_FRAMEWORK_ROUTE = "allow-listed-framework-route"


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
    return current_boot_variant() in (BootVariant.UNLISTED_FRAMEWORK_ROUTE, BootVariant.ALLOW_LISTED_FRAMEWORK_ROUTE)
