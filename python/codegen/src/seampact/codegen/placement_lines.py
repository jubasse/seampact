"""The lines every Pydantic target's placement module writes alike: the credentials types of its placement, the
api's unexpected-error listener protocol, a tuple of strings, and each operation's `add_operation` call with the
generated types it hands the runtime."""

from collections.abc import Sequence
from typing import Final

from seampact.codegen.printer import INDENT, bracketed, string_literal
from seampact.codegen.pydantic_layout import ApiLayout

_LISTENER_DOC: Final = "Hears of each failure api '{api}' answers with its 500."


def tuple_literal(items: Sequence[str]) -> str:
    texts = [string_literal(item) for item in items]

    return f"({texts[0]},)" if len(texts) == 1 else f"({', '.join(texts)})"


def credentials_types(runtime: str, layout: ApiLayout) -> list[str]:
    """The placement's `credentials=` argument: each identity's credentials class and its attribute per scheme."""
    if not layout.credentials:
        return [f"{INDENT}credentials={{}},"]

    lines = [f"{INDENT}credentials={{"]

    for identity, credentials in layout.credentials.items():
        attributes = ", ".join(
            f"{string_literal(scheme)}: {string_literal(attribute)}"
            for scheme, attribute in credentials.attributes.items()
        )
        lines += bracketed(
            INDENT * 2,
            f"{string_literal(identity)}: {runtime}.CredentialsType",
            [credentials.class_name, "{" + attributes + "}"],
            ",",
        )

    return [*lines, f"{INDENT}}},"]


def unexpected_error_listener(api: str, hooks: str, layout: ApiLayout) -> list[str]:
    return [
        f"class {layout.unexpected_error_listener}({hooks}.UnexpectedErrorListener, _typing.Protocol):",
        f'{INDENT}"""{_LISTENER_DOC.format(api=api)}"""',
    ]


def operation_types_arguments(layout: ApiLayout, operation_id: str, proofs_model: str | None) -> list[str]:
    """The arguments of one operation's `OperationTypes`; `proofs_model` is the qualified `<Op>Proofs` class."""
    names = layout.operations[operation_id]
    responses = ", ".join(f"({status}, {name})" for status, name in sorted(names.responses.items()))
    arguments = [
        f"request={names.request}",
        f"responses=({responses}{',' if len(names.responses) == 1 else ''})",
        f"errors={names.errors}",
    ]

    if proofs_model is not None:
        arguments.append(f"proofs={proofs_model}")

    return arguments


def add_operation_call(runtime: str, arguments: Sequence[str], types: Sequence[str]) -> list[str]:
    """One `add_operation` call in `bind_<api>()`, split as ruff splits it: on one line when it fits, else one argument
    per line, the operation's `OperationTypes` a nested call split the same way."""
    head = f"{runtime}.add_operation"
    single = bracketed(INDENT, head, [*arguments, f"{runtime}.OperationTypes({', '.join(types)})"], "")

    if len(single) == 1:
        return single

    return [
        f"{INDENT}{head}(",
        *(f"{INDENT * 2}{argument}," for argument in arguments),
        *bracketed(INDENT * 2, f"{runtime}.OperationTypes", types, ","),
        f"{INDENT})",
    ]
