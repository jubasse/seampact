"""Python expressions the DRF emitters print: calls, keyword arguments, lists and dicts, each written on one line
when it fits, else exploded one item per line with a trailing comma, which `ruff format` keeps as written."""

from collections.abc import Sequence
from dataclasses import dataclass

from seampact.codegen.printer import INDENT, fits


@dataclass(frozen=True, slots=True)
class Call:
    callee: str
    arguments: tuple["Expression", ...] = ()


@dataclass(frozen=True, slots=True)
class Keyword:
    name: str
    value: "Expression"


@dataclass(frozen=True, slots=True)
class ListOf:
    items: tuple["Expression", ...]


@dataclass(frozen=True, slots=True)
class DictOf:
    """Its keys are written as given (string literals)."""

    items: tuple[tuple[str, "Expression"], ...]


type Expression = str | Call | Keyword | ListOf | DictOf


def call(callee: str, arguments: Sequence[Expression] = ()) -> Call:
    return Call(callee, tuple(arguments))


def flat(expression: Expression) -> str:
    if isinstance(expression, str):
        return expression

    if isinstance(expression, Keyword):
        return f"{expression.name}={flat(expression.value)}"

    if isinstance(expression, Call):
        return f"{expression.callee}({', '.join(flat(argument) for argument in expression.arguments)})"

    if isinstance(expression, ListOf):
        return f"[{', '.join(flat(item) for item in expression.items)}]"

    return "{" + ", ".join(f"{key}: {flat(value)}" for key, value in expression.items) + "}"


def lines(expression: Expression, indent: str, prefix: str = "", suffix: str = "") -> list[str]:
    """`indent` + `prefix` + the expression + `suffix`, exploded when it does not fit."""
    single = f"{indent}{prefix}{flat(expression)}{suffix}"

    if fits(single) or isinstance(expression, str):
        return [single]

    inner = indent + INDENT

    if isinstance(expression, Keyword):
        return lines(expression.value, indent, f"{prefix}{expression.name}=", suffix)

    if isinstance(expression, Call):
        opening, closing = f"{expression.callee}(", ")"
        items = [line for argument in expression.arguments for line in lines(argument, inner, suffix=",")]
    elif isinstance(expression, ListOf):
        opening, closing = "[", "]"
        items = [line for item in expression.items for line in lines(item, inner, suffix=",")]
    else:
        opening, closing = "{", "}"
        items = [line for key, value in expression.items for line in lines(value, inner, f"{key}: ", ",")]

    return [f"{indent}{prefix}{opening}", *items, f"{indent}{closing}{suffix}"]
