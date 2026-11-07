"""The entries a success's derived response headers are written from (ADR 0004 section 7), resolved from the IR: the
Deprecation and Sunset dates and the successor `Link` of a deprecated operation, and the item field the strong `ETag`
of an item versioned by `If-Match` names (grammar section 6), or why the boundary cannot write a header. The contract
resolves them once per process, and the generators refuse, by name, each header that has a problem."""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import Enum
from typing import Final

from seampact.codegen.runtime.ir_view import IrMap, ir_list, ir_map, ir_string

_CONCURRENCY_DERIVATION: Final = "concurrency.version"
_HEADER_SOURCE: Final = "header"
_DEPRECATION: Final = "deprecation"
_SUNSET: Final = "sunset"
_SUCCESSOR_LINK: Final = "successorLink"
_CALENDAR_DATE: Final = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_WEEKDAYS: Final = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_MONTHS: Final = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_EPOCH: Final = datetime(1970, 1, 1, tzinfo=UTC)


@dataclass(frozen=True, slots=True)
class TextHeader:
    """A fixed text: a deprecation or sunset date."""

    name: str
    value: str


@dataclass(frozen=True, slots=True)
class SuccessorLinkHeader:
    """The successor's link: `path` the successor's mounted path with `{name}` params, each the request's own."""

    name: str
    path: str
    rel: str


@dataclass(frozen=True, slots=True)
class EntityTagHeader:
    """The strong entity tag of the item's version `field`."""

    name: str
    field: str


type HeaderEntry = TextHeader | SuccessorLinkHeader | EntityTagHeader


class ProblemKind(Enum):
    """Whether a header the boundary cannot write waits for a later release, or breaks a rule the compiler keeps."""

    WAITING = "waiting"
    INCONSISTENT = "inconsistent"


@dataclass(frozen=True, slots=True)
class HeaderProblem:
    """Why the boundary cannot write a response header: `code` the form or the IR rule, `description` the header."""

    kind: ProblemKind
    code: str
    description: str


def response_header_entry(
    api_id: str, mount: str, operations: Sequence[IrMap], operation: IrMap, header: IrMap
) -> HeaderEntry | HeaderProblem | None:
    """The entry the boundary writes `header` of `operation`'s response from, or why it cannot; None for a header
    another step writes."""
    semantic = ir_string(header, "semantic")
    name = (ir_string(header, "name") or "").lower()

    if semantic in (_DEPRECATION, _SUNSET, _SUCCESSOR_LINK):
        return _deprecation_entry(api_id, mount, operations, operation, name, semantic)

    derived_from = ir_map(header, "derivedFrom")

    if ir_string(derived_from, "derivation") != _CONCURRENCY_DERIVATION:
        return None

    origins = ir_list(derived_from, "from")

    return _entity_tag_entry(operations, operation, name, origins[0] if origins else None)


def deprecation_value(day: datetime) -> str:
    """RFC 9745: `@` and the unix seconds of the day at 00:00:00 UTC."""
    return f"@{int((day - _EPOCH).total_seconds())}"


def sunset_value(day: datetime) -> str:
    """RFC 8594 and RFC 9110 section 5.6.7: the IMF-fixdate of the day at 00:00:00 GMT."""
    weekday, month = _WEEKDAYS[day.weekday()], _MONTHS[day.month - 1]

    return f"{weekday}, {day.day:02d} {month} {day.year:04d} 00:00:00 GMT"


def _deprecation_entry(
    api_id: str, mount: str, operations: Sequence[IrMap], operation: IrMap, name: str, semantic: str
) -> HeaderEntry | HeaderProblem:
    deprecated = ir_map(operation, "deprecated")

    if not deprecated:
        return HeaderProblem(
            ProblemKind.INCONSISTENT,
            "ir.deprecation.headers",
            f"A {semantic} header on an operation that is not deprecated",
        )

    if semantic == _SUCCESSOR_LINK:
        return _successor_link_entry(api_id, mount, operations, deprecated, name)

    date = ir_string(deprecated, "since" if semantic == _DEPRECATION else semantic)
    day = None if date is None else _calendar_day(date)

    if day is None:
        return HeaderProblem(
            ProblemKind.INCONSISTENT, "ir.deprecation.since", f"The {semantic} header's date is not a calendar date"
        )

    return TextHeader(name, deprecation_value(day) if semantic == _DEPRECATION else sunset_value(day))


def _successor_link_entry(
    api_id: str, mount: str, operations: Sequence[IrMap], deprecated: IrMap, name: str
) -> HeaderEntry | HeaderProblem:
    successor = ir_map(deprecated, "successor")
    successor_id = ir_string(successor, "id")
    rel = ir_string(deprecated, "successorRel")

    if successor_id is None or rel is None:
        return HeaderProblem(
            ProblemKind.INCONSISTENT,
            "ir.deprecation.headers",
            "A successor link header on an operation without its successor and relation",
        )

    successor_api = ir_string(successor, "api")

    if successor_api != api_id:
        return HeaderProblem(
            ProblemKind.WAITING,
            "deprecated.successor.otherApi",
            f"The successor link to operation '{successor_id}' of api '{successor_api}'",
        )

    successor_operation = next((item for item in operations if ir_string(item, "id") == successor_id), None)

    if successor_operation is None:
        return HeaderProblem(
            ProblemKind.INCONSISTENT,
            "ir.deprecation.successor",
            f"The successor '{successor_id}' is no operation of the api",
        )

    return SuccessorLinkHeader(name, mount + (ir_string(successor_operation, "path") or ""), rel)


def _calendar_day(date: str) -> datetime | None:
    if _CALENDAR_DATE.fullmatch(date) is None:
        return None

    try:
        return datetime.fromisoformat(date).replace(tzinfo=UTC)
    except ValueError:
        return None


def _entity_tag_entry(
    operations: Sequence[IrMap], operation: IrMap, name: str, resource_origin: object
) -> HeaderEntry | HeaderProblem:
    """The tag's field: the operation's own `If-Match` version, else that of the `If-Match` writes of the resource the
    tag is derived from (a read has no `concurrency` of its own)."""
    own_field = _if_match_field(operation)

    if own_field is not None:
        return EntityTagHeader(name, own_field)

    fields = {
        field
        for candidate in operations
        if (field := _if_match_field(candidate)) is not None
        and _same_origin(ir_list(ir_map(ir_map(candidate, "concurrency"), "derivedFrom"), "from"), resource_origin)
    }

    if len(fields) == 1:
        return EntityTagHeader(name, next(iter(fields)))

    if fields:
        return HeaderProblem(
            ProblemKind.INCONSISTENT,
            "concurrency.etag.field",
            "The If-Match writes of the resource this ETag is derived from compare different fields",
        )

    return HeaderProblem(
        ProblemKind.WAITING,
        "concurrency.etag.withoutWrite",
        "An ETag of a resource whose If-Match writes are not operations of this api",
    )


def _if_match_field(operation: IrMap) -> str | None:
    concurrency = ir_map(operation, "concurrency")

    if ir_string(ir_map(concurrency, "version"), "in") != _HEADER_SOURCE:
        return None

    return ir_string(concurrency, "field")


def _same_origin(write_origins: Sequence[object], resource_origin: object) -> bool:
    if not write_origins or not isinstance(resource_origin, Mapping):
        return False

    write_origin = write_origins[0]

    if not isinstance(write_origin, Mapping):
        return False

    return all(write_origin.get(key) == resource_origin.get(key) for key in ("layer", "pointer"))
