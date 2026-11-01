"""The keys and value forms of ADR 0011 the Python runner does not read yet, each with the work that brings it, as
the Node CLI's `config-waits.ts`: each is refused by name (`config.key.waits`), never ignored. A target entry of
another ecosystem is not a wait here: the Python runner leaves it to its own runner."""

from typing import Final

from seampact.ir.config.config_tree import ConfigTree
from seampact.ir.config.json_value import JsonValue, as_mapping, list_of, object_of
from seampact.ir.config.problem import ConfigProblem
from seampact.ir.config.schema_check import KeyProblem

_SERVER_ENTRY_BRINGER: Final = "the boundary runtime of the Python server targets"
# A module link only arises across the apps of a monorepo, and no app links across apps yet.
_MODULE_LINK_BRINGER: Final = "links across the apps of a monorepo, once an app needs one"
_ENTRY_KEY_WAITS: Final = ("access",)
# The handler check of the boot check comes with the access hooks (ADR 0012).
_BOOT_CHECK_HANDLERS: Final = "handlers"


def waiting_key_problems(tree: ConfigTree) -> list[KeyProblem]:
    """Every waiting key of `tree`, the parsed value not yet schema-checked, as `config.key.waits`."""
    problems: list[KeyProblem] = []

    for index, entry in enumerate(list_of(tree.value, "targets") or []):
        for path, what, bringer in _entry_waits(entry, ["targets", index]):
            problem = ConfigProblem(
                "config.key.waits",
                f"{what[:1].upper()}{what[1:]} is not available yet; it comes with {bringer}.",
                "Remove it from the config for now.",
                tree.where_of(path),
            )
            problems.append(KeyProblem(tuple(path), problem))

    return problems


def _entry_waits(entry: JsonValue, path: list[str | int]) -> list[tuple[list[str | int], str, str]]:
    if not isinstance(entry, dict):
        return []

    waits: list[tuple[list[str | int], str, str]] = [
        ([*path, key], f"the key '{key}'", _SERVER_ENTRY_BRINGER) for key in _ENTRY_KEY_WAITS if key in entry
    ]
    boot_check = object_of(object_of(entry, "artefacts"), "bootCheck")

    if boot_check is not None and _BOOT_CHECK_HANDLERS in boot_check:
        waits.append(
            (
                [*path, "artefacts", "bootCheck", _BOOT_CHECK_HANDLERS],
                f"the boot check switch '{_BOOT_CHECK_HANDLERS}'",
                _SERVER_ENTRY_BRINGER,
            )
        )

    for kind, provider in as_mapping(entry.get("link")).items():
        if isinstance(provider, dict):
            waits.append(([*path, "link", kind], "a link with an explicit module specifier", _MODULE_LINK_BRINGER))

    return waits
