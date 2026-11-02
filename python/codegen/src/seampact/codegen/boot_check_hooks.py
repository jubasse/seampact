"""The `artefacts.bootCheck.hooks` value, read the same on every Python target: `error` (default) or `off`; `warn`
is refused by name until a consumer needs it, any other value as invalid."""

from typing import Final

from seampact.codegen.refusals import Delivery, IrPlace, Refusals
from seampact.ir.config.json_value import JsonValue

HOOKS_ERROR: Final = "error"
HOOKS_OFF: Final = "off"
_HOOKS_WARN: Final = "warn"
_NAME: Final = "bootCheck.hooks"


def read_boot_check_hooks(value: JsonValue, at: IrPlace, refusals: Refusals) -> bool:
    """Whether a missing hook fails the boot; a refused value reads as the default, `error`."""
    if value == HOOKS_OFF:
        return False

    if value == HOOKS_ERROR:
        return True

    if value == _HOOKS_WARN:
        refusals.waiting(
            f"artefacts.{_NAME}.{_HOOKS_WARN}",
            "'bootCheck.hooks: warn' (start with hooks missing)",
            at,
            Delivery.CONSUMER,
        )
        return True

    refusals.add(
        f"artefacts.{_NAME}.invalid",
        f"The artefact '{_NAME}' is {value!r}, not '{HOOKS_ERROR}', '{HOOKS_OFF}' or '{_HOOKS_WARN}'.",
        f"Set '{_NAME}' to one of the listed values, or remove it for its default.",
        at,
    )
    return True
