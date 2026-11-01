"""Reads an IR document into the generated model, after the checks that make it safe to act on."""

import json
from typing import Final

from seampact.ir.hydration import IrModelError
from seampact.ir.model import ContractIR
from seampact.ir.read.must_act import check_must_act
from seampact.ir.read.nesting import check_document_nesting, check_text_nesting
from seampact.ir.read.refusal import IrMalformedError, IrRefusal, IrRefusedError, in_message
from seampact.ir.read.support import IrSupport, check_support

# The error's own message keeps this much of a cause that can quote untrusted input.
_MAX_CAUSE_MESSAGE_LENGTH: Final = 400
# An integer literal longer than this reads as a float, as other JSON parsers read one past 64 bits; it also keeps
# `int()` off a literal of thousands of digits.
_MAX_INTEGER_DIGITS: Final = 19


def read_ir(text: str, support: IrSupport) -> ContractIR:
    """Reads an IR text. Before anything is parsed or hydrated it checks, in order: the nesting depth of the whole
    document (`ir.nesting.too-deep`, alone, past 256 arrays and objects); `irVersion` and `irRevision` and the
    declaration kinds and features the reader supports; then the unknown tags and values of must-act definitions.
    Every other unknown member, tag and value is tolerated: members are dropped, tags and values kept as `Unknown`.

    The reader bounds its own work and output: nesting depth, at most 100 refusals per check, and every untrusted
    string cut in a message. A refusal still keeps its pointer and operation id whole, so callers bound the size of
    the input they read.

    Raises `IrRefusedError` when the IR is nested too deep or is not one `support` reads or acts on safely, and
    `IrMalformedError` when the text is not JSON or not an IR.
    """
    _refuse_if_present(check_text_nesting(text))

    return _read_within_nesting_bound(_parse(text), support)


def read_document(document: object, support: IrSupport) -> ContractIR:
    """Reads the output of `json.loads(text)`; see `read_ir`."""
    _refuse_if_present(check_document_nesting(document))

    return _read_within_nesting_bound(document, support)


def _read_within_nesting_bound(document: object, support: IrSupport) -> ContractIR:
    _refuse_unless_empty(check_support(document, support))
    _refuse_unless_empty(check_must_act(document))

    try:
        return ContractIR.from_json(document)
    except IrModelError as error:
        raise IrMalformedError(f"The IR does not match the IR model: {_cause_of(error)}") from error


def _parse(text: str) -> object:
    try:
        return json.loads(text, parse_constant=_refuse_constant, parse_int=_parse_integer)
    except ValueError as error:
        raise IrMalformedError(f"The IR is not JSON: {_cause_of(error)}") from error


def _refuse_constant(constant: str) -> object:
    raise ValueError(f"{constant} is not a JSON value")


def _parse_integer(literal: str) -> int | float:
    digits = literal.removeprefix("-")

    return int(literal) if len(digits) <= _MAX_INTEGER_DIGITS else float(literal)


def _cause_of(error: Exception) -> str:
    return in_message(str(error), _MAX_CAUSE_MESSAGE_LENGTH)


def _refuse_if_present(refusal: IrRefusal | None) -> None:
    if refusal is not None:
        raise IrRefusedError([refusal])


def _refuse_unless_empty(refusals: list[IrRefusal]) -> None:
    if refusals:
        raise IrRefusedError(refusals)
