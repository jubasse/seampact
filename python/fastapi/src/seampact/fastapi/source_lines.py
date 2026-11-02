"""Lines of generated Python that ruff formats as written: the package-relative imports, which ruff sorts after the
seampact ones, one blank line before the first statement and two before a class or function."""

from collections.abc import Sequence
from typing import Final

from seampact.codegen.printer import INDENT, fits

_DEFINITIONS: Final = ("class ", "def ", "async def ", "@")
OPERATIONS_MODULE: Final = "operations"


def with_local_imports(modules: Sequence[str], names: Sequence[str], first_block: Sequence[str]) -> list[str]:
    """The first block of a module, preceded by `from . import <module> as _<module>` for each sibling module and
    `from .operations import <names>` for names of the package's operations module, sorted as ruff sorts them."""
    imports = [f"from . import {module} as _{module}" for module in sorted(modules)]
    ordered = sorted(set(names), key=_member_order)
    single = f"from .{OPERATIONS_MODULE} import {', '.join(ordered)}"

    if ordered and fits(single):
        imports.append(single)
    elif ordered:
        imports += [f"from .{OPERATIONS_MODULE} import (", *(f"{INDENT}{name}," for name in ordered), ")"]

    separator = ["", ""] if first_block and first_block[0].startswith(_DEFINITIONS) else [""]

    return [*imports, *separator, *first_block]


def _member_order(name: str) -> tuple[int, str]:
    """ruff's `order-by-type`: constants, then classes, then the rest; modules are lower case."""
    if name.isupper():
        return (0, name)

    return (1, name) if name[:1].isupper() else (2, name)
