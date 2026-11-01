"""A named reason to refuse an IR, the bounded list a check gathers, and the errors a read raises."""

import math
from dataclasses import dataclass
from enum import Enum, StrEnum
from typing import Final

from seampact.ir.hydration import json_type

# A refusal list stops here: a pointer repeats every map key above it, so an unbounded list of refusals under a long
# key would copy that key without bound.
MAX_REFUSALS: Final = 100

_MAX_MESSAGE_VALUE_LENGTH: Final = 80
# A float is shown in plain form only when it is integral and has at most this many digits.
_MAX_PLAIN_FLOAT: Final = 1.0e15


class IrRefusalCode(StrEnum):
    """The codes of `checkIrSupport`, then two codes local to the native readers: an unknown tag or value of a
    must-act definition, and a document nested past the depth they read."""

    VERSION_UNSUPPORTED = "ir.version.unsupported"
    REVISION_MISMATCH = "ir.revision.mismatch"
    KIND_UNSUPPORTED = "ir.kind.unsupported"
    FEATURE_UNSUPPORTED = "ir.feature.unsupported"
    SUPPORT_MALFORMED = "ir.support.malformed"
    MUST_ACT_UNKNOWN = "ir.must-act.unknown"
    NESTING_TOO_DEEP = "ir.nesting.too-deep"


@dataclass(frozen=True, slots=True)
class IrRefusal:
    """One named reason to refuse an IR.

    `member` is the JSON Pointer of the refused value. `operation` is the id of the operation it is in, `None`
    outside one and for `ir.nesting.too-deep`, which refuses before reading anything. `value` and `expected` by code:
    version, revision, kind, feature and must-act give the refused value (a string as is, a number in plain form,
    an array or object by its JSON type, an absent one `missing`) and the values the reader accepts;
    `ir.support.malformed` gives the JSON type found and `("array",)`; `ir.nesting.too-deep` gives the depth reached,
    the bound plus one, and the bound, with `member` the first array or object past the bound in document order.
    `message` cuts every untrusted string; the other fields keep it whole.
    """

    code: IrRefusalCode
    member: str
    value: str
    expected: tuple[str, ...]
    operation: str | None
    message: str


class RefusalList:
    """The refusals of one check, stopping after `MAX_REFUSALS`."""

    def __init__(self) -> None:
        self._refusals: list[IrRefusal] = []

    def is_full(self) -> bool:
        return len(self._refusals) >= MAX_REFUSALS

    def add(self, refusal: IrRefusal) -> None:
        if not self.is_full():
            self._refusals.append(refusal)

    def all(self) -> list[IrRefusal]:
        return list(self._refusals)


class IrRefusedError(Exception):
    """The IR is one this reader must not act on: every reason, named, up to 100 (ADR 0005 sections 2 and 3)."""

    def __init__(self, refusals: list[IrRefusal]) -> None:
        super().__init__("\n".join(f"{refusal.code.value}: {refusal.message}" for refusal in refusals))
        self.refusals = tuple(refusals)


class IrMalformedError(Exception):
    """The text is not JSON, or its JSON is not an IR of this model's shape."""


class Missing(Enum):
    """The value of a member the document does not have, apart from a member that is JSON null."""

    ABSENT = "absent"


def in_message(value: str, max_length: int = _MAX_MESSAGE_VALUE_LENGTH) -> str:
    """An untrusted string cut for a message; the refusal's other fields keep it whole."""
    return value if len(value) <= max_length else f"{value[:max_length]}..."


def escape_pointer_segment(member: str) -> str:
    """A member name as one JSON Pointer segment (RFC 6901)."""
    return member.replace("~", "~0").replace("/", "~1")


def refused_json_type(value: object) -> str:
    return "missing" if value is Missing.ABSENT else json_type(value)


def shown(value: object) -> str:
    """A string as is, a number in plain form, `true`, `false` or `null`, and an array or object by its JSON type:
    rendering a container would copy any amount of untrusted input into every refusal."""
    if isinstance(value, str):
        return value

    if isinstance(value, bool):
        return "true" if value else "false"

    if isinstance(value, int):
        return str(value)

    if isinstance(value, float):
        return _shown_float(value)

    return refused_json_type(value)


def _shown_float(value: float) -> str:
    if math.isfinite(value) and value.is_integer() and abs(value) < _MAX_PLAIN_FLOAT:
        return str(int(value))

    return repr(value)


@dataclass(frozen=True, slots=True)
class PointerStep:
    """A JSON Pointer as a link to its parent: a step costs one node, and the string is built only for a refusal,
    so a long key is not copied for every node below it. The root document is `None`."""

    parent: "PointerStep | None"
    segment: str


def pointer_of(step: PointerStep | None) -> str:
    segments: list[str] = []
    current = step

    while current is not None:
        segments.append(f"/{escape_pointer_segment(current.segment)}")
        current = current.parent

    return "".join(reversed(segments))
