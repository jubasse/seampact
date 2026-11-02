"""The `deadline` property of a generated `<Op>Request` on an operation that reads a deadline header (grammar section
9): the instant the caller stops waiting, read from the header its input already holds, so every target fills it
alike and the handler asks it for the time left."""

from typing import Final

from seampact.codegen.names import member_identifier
from seampact.codegen.printer import INDENT, PythonModule
from seampact.codegen.refusals import Delivery, IrPlace, Refusals
from seampact.ir.model import Operation, Param, ScalarType, ScalarTypeUse

_DATE_TIME_FORMAT: Final = "date-time"


def deadline_property(module: PythonModule, operation: Operation, at: IrPlace, refusals: Refusals) -> list[str]:
    """The property's lines, after a blank line; none when the operation reads no deadline header."""
    header = operation.deadline_header

    if header is None:
        return []

    param = next((param for param in operation.params.header if param.name == header), None)

    if param is None:
        refusals.inconsistent(
            "deadline.header.missing",
            f"The deadline header '{header}' of operation '{operation.id}' is not one of its header parameters",
            at.below("deadlineHeader"),
        )
        return []

    deadline = module.imported("seampact.codegen.runtime.deadline", "_deadline")
    value = f"self.input.headers.{member_identifier(param.name)}"
    read = _deadline_read(deadline, param, value)

    if read is None:
        refusals.waiting(
            "deadline.header.type",
            f"A deadline header '{header}' typed other than a plain string or a date-time",
            at.below("deadlineHeader"),
            Delivery.CONSUMER,
        )
        return []

    return [
        "",
        f"{INDENT}@property",
        f"{INDENT}def deadline(self) -> {deadline}.RequestDeadline | None:",
        f'{INDENT * 2}"""When the caller stops waiting, from its \'{header}\' header; None when it sent none."""',
        f"{INDENT * 2}return {read}",
    ]


def _deadline_read(deadline: str, param: Param, value: str) -> str | None:
    """The expression reading the deadline from the header's value: its text parsed, or its date-time wrapped as
    the input already decoded it; None for another type."""
    type_use = param.type

    if not isinstance(type_use, ScalarTypeUse) or type_use.type != ScalarType.STRING or type_use.scalar is not None:
        return None

    if type_use.format is None:
        return f"{deadline}.sent_deadline({value})"

    if type_use.format == _DATE_TIME_FORMAT:
        return f"None if {value} is None else {deadline}.RequestDeadline({value})"

    return None
