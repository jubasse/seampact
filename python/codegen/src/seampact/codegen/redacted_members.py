"""The generated marker that prints `[redacted]` in place of a sensitive value, and the `__repr__` and `__rich_repr__`
of a generated dataclass that print its sensitive members through it (ADR 0026 "Redaction")."""

from collections.abc import Collection, Sequence
from typing import Final

from seampact.codegen.printer import INDENT, string_literal

REDACTED_CLASS: Final = "_Redacted"
_REDACTED: Final = "[redacted]"


def redacted_marker_block() -> list[str]:
    """The module-level marker class; a module declares it once, before its first use."""
    return [
        f"class {REDACTED_CLASS}:",
        f'{INDENT}"""Stands for a sensitive value in a `repr`."""',
        "",
        f"{INDENT}def __repr__(self) -> str:",
        f"{INDENT}{INDENT}return {string_literal(_REDACTED)}",
    ]


def redacted_dataclass_reprs(
    class_name: str, members: Sequence[str], redacted: Collection[str], abc_alias: str
) -> list[str]:
    """The `__repr__` and `__rich_repr__` methods of a generated dataclass: its `members` in order, each one in
    `redacted` printed `[redacted]`, the others by their own `repr`."""
    rendered = ", ".join(
        f"{member}={_REDACTED}" if member in redacted else f"{member}={{self.{member}!r}}" for member in members
    )
    shown = any(member not in redacted for member in members)
    returned = f'f"{class_name}({rendered})"' if shown else string_literal(f"{class_name}({rendered})")
    rich_members = [
        f"{INDENT}{INDENT}yield {string_literal(member)}, "
        + (f"{REDACTED_CLASS}()" if member in redacted else f"self.{member}")
        for member in members
    ]

    return [
        "",
        f"{INDENT}def __repr__(self) -> str:",
        f"{INDENT}{INDENT}return {returned}",
        "",
        f"{INDENT}def __rich_repr__(self) -> {abc_alias}.Iterator[tuple[str, object]]:",
        *rich_members,
    ]
