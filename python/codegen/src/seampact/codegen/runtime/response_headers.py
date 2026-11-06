"""The response headers a success writes from its response's entries (ADR 0004 section 7): the Deprecation and Sunset
dates and the successor `Link` of a deprecated operation, and the strong `ETag` of an item versioned by `If-Match`
(grammar section 6). The idempotency replay, `cache.etag` and the paging headers are written by their own steps."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final
from urllib.parse import quote

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError
from seampact.codegen.runtime.ir_view import IrMap, ir_int
from seampact.codegen.runtime.replies import Reply
from seampact.codegen.runtime.response_header_entries import (
    EntityTagHeader,
    HeaderProblem,
    SuccessorLinkHeader,
    TextHeader,
)
from seampact.codegen.runtime.value_rules import MAX_SAFE_INTEGER
from seampact.codegen.runtime.wire_values import decoded_segment

_PATH_PARAM: Final = re.compile(r"\{([^}]+)\}")
# RFC 9110 section 8.8.3 `etagc`: a version whose text holds another character makes no strong entity tag.
_ENTITY_TAG_TEXT: Final = re.compile(r"[\x21\x23-\x7e]*")


@dataclass(frozen=True, slots=True)
class DerivedHeaders:
    """A success's derived headers: those of a success, and the entity tag, which a 304 keeps too."""

    success_headers: tuple[tuple[str, str], ...]
    entity_tag: tuple[str, str] | None


def derived_response_headers(
    contract: ApiContract, operation_id: str, response: IrMap, item: object, raw_parameters: Mapping[str, str]
) -> DerivedHeaders:
    """The derived headers of `response` for the handler's item in wire names, from the entries the contract resolved
    once. Raises `BoundaryFailureError` for an item whose version field is no safe integer or entity tag text, or a
    header the generator should have refused."""
    success_headers: list[tuple[str, str]] = []
    entity_tag: tuple[str, str] | None = None

    for entry in contract.response_header_entries(operation_id, ir_int(response, "status") or 0):
        if isinstance(entry, HeaderProblem):
            raise BoundaryFailureError(
                f"seampact: operation '{operation_id}' cannot write {entry.description} ({entry.code}); regenerate "
                "the api."
            )

        if isinstance(entry, TextHeader):
            success_headers.append((entry.name, entry.value))
        elif isinstance(entry, SuccessorLinkHeader):
            success_headers.append((entry.name, successor_link(entry.path, entry.rel, raw_parameters)))
        elif isinstance(entry, EntityTagHeader):
            entity_tag = (entry.name, _version_entity_tag(operation_id, entry.field, item))

    return DerivedHeaders(tuple(success_headers), entity_tag)


def successor_link(path: str, rel: str, raw_parameters: Mapping[str, str]) -> str:
    """RFC 8288: `<target>; rel="<rel>"`, each param of the successor's path the request's param of the same name, its
    decoded value encoded as one path segment, so a value never breaks out of the link."""

    def segment(placeholder: re.Match[str]) -> str:
        name = placeholder.group(1)
        raw = raw_parameters.get(name)
        decoded = None if raw is None else decoded_segment(raw)

        if decoded is None:
            raise BoundaryFailureError(
                f"seampact: the successor path '{path}' names the param '{name}', which the request has not as UTF-8 "
                "text; regenerate the api."
            )

        # Every byte outside RFC 3986 `unreserved` is percent-encoded, as every target writes the link.
        return quote(decoded, safe="")

    return f'<{_PATH_PARAM.sub(segment, path)}>; rel="{rel}"'


def _version_entity_tag(operation_id: str, field: str, item: object) -> str:
    """The item's version as a strong entity tag, `"7"`: the field's integer or text, as the client sends it back."""
    version = item.get(field) if isinstance(item, Mapping) else None
    text = str(version) if _is_safe_integer(version) else version

    if not isinstance(text, str) or _ENTITY_TAG_TEXT.fullmatch(text) is None:
        raise BoundaryFailureError(
            f"seampact: the handler of '{operation_id}' returned an item whose version field '{field}' is no safe "
            "integer or entity tag text, so its ETag cannot be written; return the item with its version."
        )

    return f'"{text}"'


# A version beyond 2^53 - 1 is no ETag: a JavaScript client could not hold it exactly, so every target refuses it.
def _is_safe_integer(version: object) -> bool:
    return isinstance(version, int) and not isinstance(version, bool) and abs(version) <= MAX_SAFE_INTEGER


def with_entity_tag(headers: tuple[tuple[str, str], ...], derived: DerivedHeaders) -> tuple[tuple[str, str], ...]:
    """`headers` and the item's entity tag, which `cache.etag` then uses (grammar section 6)."""
    return headers if derived.entity_tag is None else (*headers, derived.entity_tag)


def with_success_headers(reply: Reply, derived: DerivedHeaders, success_status: int) -> Reply:
    """`reply` with the success headers; the cache's 304 for a `success_status` reply is no success, so it keeps only
    its entity tag (ADR 0004 section 7)."""
    if reply.status != success_status or not derived.success_headers:
        return reply

    return Reply(reply.status, (*reply.headers, *derived.success_headers), reply.body)
