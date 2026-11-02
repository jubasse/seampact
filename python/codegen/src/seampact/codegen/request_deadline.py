"""The `deadline` property of a generated `<Op>Request` on an operation that reads a deadline header (grammar section
9): the instant the caller stops waiting, read from the header its input already holds, so every target fills it
alike and the handler asks it for the time left."""

from seampact.codegen.names import member_identifier
from seampact.codegen.printer import INDENT, PythonModule
from seampact.codegen.refusals import IrPlace, Refusals
from seampact.ir.model import Operation


def deadline_property(module: PythonModule, operation: Operation, at: IrPlace, refusals: Refusals) -> list[str]:
    """The property's lines, after a blank line; none when the operation reads no deadline header."""
    header = operation.deadline_header

    if header is None:
        return []

    attribute = next((member_identifier(param.name) for param in operation.params.header if param.name == header), None)

    if attribute is None:
        refusals.inconsistent(
            "deadline.header.missing",
            f"The deadline header '{header}' of operation '{operation.id}' is not one of its header parameters",
            at.below("deadlineHeader"),
        )
        return []

    deadline = module.imported("seampact.codegen.runtime.deadline", "_deadline")

    return [
        "",
        f"{INDENT}@property",
        f"{INDENT}def deadline(self) -> {deadline}.RequestDeadline | None:",
        f'{INDENT * 2}"""When the caller stops waiting, from its \'{header}\' header; None when it sent none."""',
        f"{INDENT * 2}return {deadline}.sent_deadline(self.input.headers.{attribute})",
    ]
