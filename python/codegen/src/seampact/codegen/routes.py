"""The route table of one api, as every Python placement declares it (ADR 0026 "Routes"): one route per operation,
named `seampact.<api>.<operationId>`, its path in the framework's placeholder syntax with each placeholder named after
the parameter's attribute, `GET` also serving `HEAD`, and literal segments before placeholders at each depth. Static
segments holding `{`, `}` or `?`, segments a client sends percent-encoded, and segments that mix a placeholder with
text are refused by name."""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from functools import cmp_to_key
from typing import Final

from seampact.codegen.names import member_identifier
from seampact.codegen.refusals import Delivery, IrPlace, Refusals
from seampact.ir.model import ContractIR, HttpMethod, Operation

_PLACEHOLDER: Final = re.compile(r"\{([^{}]+)\}")
# What a client sends unencoded in a path segment (RFC 3986 pchar without `%`).
_SENT_AS_IS: Final = re.compile(r"[A-Za-z0-9\-._~!$&'()*+,;=:@]*")
_LITERAL_SYNTAX: Final = frozenset("{}?")


@dataclass(frozen=True, slots=True)
class RouteSegment:
    """A literal segment's text, or a placeholder's wire name and attribute."""

    text: str
    attribute: str | None = None


@dataclass(frozen=True, slots=True)
class RouteEntry:
    operation_id: str
    name: str
    methods: tuple[str, ...]
    contract_path: str
    segments: tuple[RouteSegment, ...]

    def path(self) -> str:
        """The path with `{attribute}` placeholders, as Starlette, Django and Ninja name them."""
        return "".join(
            "/" + (segment.text if segment.attribute is None else f"{{{segment.attribute}}}")
            for segment in self.segments
        )


def route_name(api_id: str, operation_id: str) -> str:
    return f"seampact.{api_id}.{operation_id}"


def route_table(ir: ContractIR, mount: str, refusals: Refusals) -> list[RouteEntry]:
    entries = [
        entry
        for index, operation in enumerate(ir.operations)
        if (entry := _entry(ir.api.id, operation, mount, IrPlace(f"/operations/{index}", operation.id), refusals))
    ]

    return sorted(entries, key=cmp_to_key(_literals_first))


def _entry(api_id: str, operation: Operation, mount: str, at: IrPlace, refusals: Refusals) -> RouteEntry | None:
    if not isinstance(operation.method, HttpMethod):
        refusals.unknown_value(operation.method.raw, at.below("method"))
        return None

    method = operation.method.value.upper()
    contract_path = mount + operation.path
    segments = [_segment(text, operation, at.below("path"), refusals) for text in contract_path.split("/")[1:]]

    if any(segment is None for segment in segments):
        return None

    methods = (method, "HEAD") if method == "GET" else (method,)

    return RouteEntry(
        operation.id,
        route_name(api_id, operation.id),
        methods,
        contract_path,
        tuple(segment for segment in segments if segment is not None),
    )


def _segment(text: str, operation: Operation, at: IrPlace, refusals: Refusals) -> RouteSegment | None:
    placeholder = _PLACEHOLDER.fullmatch(text)

    if placeholder is not None:
        return _placeholder(placeholder.group(1), operation, at, refusals)

    if "{" in text and "}" in text:
        refusals.waiting(
            "path.segment.mixed", f"The path segment '{text}', a placeholder mixed with text", at, Delivery.CONSUMER
        )
        return None

    if _LITERAL_SYNTAX.intersection(text):
        refusals.waiting(
            "path.segment.literal",
            f"The static path segment '{text}', holding '{{', '}}' or '?'",
            at,
            Delivery.CONSUMER,
        )
        return None

    if _SENT_AS_IS.fullmatch(text) is None:
        refusals.waiting(
            "path.segment.encoded",
            f"The static path segment '{text}', which a client percent-encodes",
            at,
            Delivery.CONSUMER,
        )
        return None

    return RouteSegment(text)


def _placeholder(wire_name: str, operation: Operation, at: IrPlace, refusals: Refusals) -> RouteSegment | None:
    param = next((param for param in operation.params.path if param.name == wire_name), None)
    attribute = None if param is None else member_identifier(param.name)

    if attribute is None:
        refusals.inconsistent(
            "path.param.missing", f"The path placeholder '{{{wire_name}}}' names no path parameter", at
        )
        return None

    return RouteSegment(wire_name, attribute)


def _literals_first(first: RouteEntry, second: RouteEntry) -> int:
    for mine, theirs in zip(first.segments, second.segments, strict=False):
        if (mine.attribute is None) != (theirs.attribute is None):
            return -1 if mine.attribute is None else 1

    return len(first.segments) - len(second.segments)


def placeholders(entry: RouteEntry) -> Sequence[RouteSegment]:
    return [segment for segment in entry.segments if segment.attribute is not None]
