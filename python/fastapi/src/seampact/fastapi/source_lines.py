"""Lines of generated Python that ruff formats as written: a call or a signature on one line when it fits, else its
arguments on one indented line, else one per line with a trailing comma; and the package-relative imports, which ruff
sorts after the seampact ones, one blank line before the first statement and two before a class or function."""

from collections.abc import Sequence
from typing import Final

from seampact.codegen.printer import INDENT, fits

_DEFINITIONS: Final = ("class ", "def ", "async def ", "@")


def bracketed(indent: str, head: str, arguments: Sequence[str], tail: str) -> list[str]:
    """`head(arguments)tail` at `indent`, split as ruff splits it."""
    single = f"{indent}{head}({', '.join(arguments)}){tail}"

    if fits(single):
        return [single]

    hugged = f"{indent}{INDENT}{', '.join(arguments)}"

    if fits(hugged) and not any(argument == "*" for argument in arguments):
        return [f"{indent}{head}(", hugged, f"{indent}){tail}"]

    return [f"{indent}{head}(", *(f"{indent}{INDENT}{argument}," for argument in arguments), f"{indent}){tail}"]


def with_local_imports(modules: Sequence[str], names: Sequence[str], first_block: Sequence[str]) -> list[str]:
    """The first block of a module, preceded by `from . import <module> as _<module>` for each sibling module and
    `from . import <names>` for names of the package's root, sorted as ruff sorts them."""
    imports: list[str] = []
    ordered = sorted(set(names), key=_member_order)
    single = f"from . import {', '.join(ordered)}"

    if ordered and fits(single):
        imports.append(single)
    elif ordered:
        imports += ["from . import (", *(f"{INDENT}{name}," for name in ordered), ")"]

    # ruff writes an aliased import after the plain ones of the same module.
    imports += [f"from . import {module} as _{module}" for module in sorted(modules)]

    separator = ["", ""] if first_block and first_block[0].startswith(_DEFINITIONS) else [""]

    return [*imports, *separator, *first_block]


def _member_order(name: str) -> tuple[int, str]:
    """ruff's `order-by-type`: constants, then classes, then the rest; modules are lower case."""
    if name.isupper():
        return (0, name)

    return (1, name) if name[:1].isupper() else (2, name)
