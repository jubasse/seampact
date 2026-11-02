"""The page a paged list answers (ADR 0002 section 14): the limit the handler receives, then the body, headers and
`Link` relations the paging style writes from the handler's page facts and the request's position. Links are
relative references (`api.wire.urls: relative`); absolute URLs are refused by name until a consumer needs them."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final, TypeGuard

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError
from seampact.codegen.runtime.ir_view import IrMap, ir_int, ir_map, ir_maps, ir_string, ir_strings
from seampact.codegen.runtime.templates import render
from seampact.codegen.runtime.wire_values import component_encoded, kept_query_pairs

LINK: Final = "link"

_LIMIT_ROLE: Final = "limit"
_BEFORE_ROLE: Final = "before"
_AFTER_ROLE: Final = "after"
_CLAMP: Final = "clamp"
_NULL_ABSENT: Final = "null"
_PAGE: Final = "page"
_OFFSET: Final = "offset"
_SINCE: Final = "since"
_CURSOR: Final = "cursor"
_MORE: Final = "more"
_TOTAL: Final = "total"
_ABSOLUTE_URLS: Final = "absolute"
_DEFAULT_PAGE_BASE: Final = 1
_FIRST_OFFSET: Final = 0
# The largest position the contract's int64 page and offset parameters carry.
_INT64_MAX: Final = 2**63 - 1


@dataclass(frozen=True, slots=True)
class PageParts:
    """The page body (`{}` when the template writes none) and the headers its style writes, names in lower case."""

    body: object
    headers: tuple[tuple[str, str], ...]


def filled_page_query(contract: ApiContract, operation_id: str, query: Mapping[str, object]) -> dict[str, object]:
    """The query the handler receives: the route's default limit when the client sent none, and the route's
    `maxLimit` for a larger one under `overLimit: clamp` (a larger one under `reject` was refused by the input
    step)."""
    paging = ir_map(contract.operation(operation_id), "paging")
    limit_param = _role_name(_style(contract, operation_id), _LIMIT_ROLE)
    filled = dict(query)

    if not paging or limit_param is None:
        return filled

    limit = _effective_limit(paging, query.get(limit_param))

    if limit is not None:
        filled[limit_param] = limit

    return filled


def page_parts(
    contract: ApiContract,
    operation_id: str,
    query: Mapping[str, object],
    raw_query: str,
    items: Sequence[object],
    facts: Mapping[str, object],
    status: int,
    request_path: str,
) -> PageParts:
    """The page body and headers from the handler's page facts by name (`items` already encoded and projected), the
    decoded `query` and the raw one the links keep.

    Raises `BoundaryFailureError` for absolute URLs, or a numbered style without a limit."""
    if ir_string(ir_map(ir_map(contract.ir_view, "api"), "wire"), "urls") == _ABSOLUTE_URLS:
        raise BoundaryFailureError(
            f"seampact: the api '{contract.api}' writes absolute URLs ('api.wire.urls: absolute'), which this "
            "seampact release does not write in page links yet; write relative URLs."
        )

    style = _style(contract, operation_id)
    write_nulls = ir_string(style, "absent") == _NULL_ABSENT
    slots: dict[str, object] = {
        name: facts[name] for name in ir_strings(style, "handlerResult") if facts.get(name) is not None
    }
    limit = _limit_of(contract, operation_id, style, query)

    if limit is not None:
        slots[_LIMIT_ROLE] = limit
        total = facts.get(_TOTAL)

        if _is_int(total) and limit > 0:
            slots["totalPages"] = -(-total // limit)

    slots["self"] = _page_url(_without_query_members(raw_query, []))
    position = ir_string(style, "position")

    if position in (_PAGE, _OFFSET):
        _add_numbered_slots(operation_id, style, query, raw_query, facts, len(items), limit, slots)
    else:
        _add_token_slots(style, raw_query, facts, position, slots)

    slots["items"] = list(items)
    slots["status"] = status
    slots["path"] = request_path
    meta = _rendered_meta(style, slots, write_nulls)

    if meta is not None:
        slots["meta"] = meta

    body = render(_page_body(contract, operation_id, style), slots, write_nulls)

    return PageParts(body.value if body.present else {}, _headers(style, slots))


def _style(contract: ApiContract, operation_id: str) -> IrMap:
    style_id = ir_string(ir_map(contract.operation(operation_id), "paging"), "style") or ""

    return contract.declaration("pagings", style_id)


def _page_body(contract: ApiContract, operation_id: str, style: IrMap) -> object:
    """The style's own body, or the format's page body, whose `$meta` the style's meta joins."""
    body = ir_map(style, "response").get("body")

    if body is not None:
        return body

    return ir_map(ir_map(contract.format(operation_id), "success"), _PAGE).get("body")


def _rendered_meta(style: IrMap, slots: Mapping[str, object], write_nulls: bool) -> dict[str, object] | None:
    """The style's meta members, joined into the format's `$meta`; none leaves `$meta` without a value."""
    meta: dict[str, object] = {}

    for member in ir_maps(ir_map(style, "response"), "meta"):
        value = render(member.get("value"), slots, write_nulls)
        name = ir_string(member, "name") or ""

        if value.present:
            meta[name] = value.value
        elif write_nulls:
            meta[name] = None

    return meta or None


def _headers(style: IrMap, slots: Mapping[str, object]) -> tuple[tuple[str, str], ...]:
    response = ir_map(style, "response")
    headers: list[tuple[str, str]] = []

    for header in ir_maps(response, "headers"):
        value = render(header.get("value"), slots, write_nulls=False)

        if value.present and (isinstance(value.value, str) or _is_int(value.value)):
            headers.append(((ir_string(header, "name") or "").lower(), str(value.value)))

    relations = [
        f'<{url}>; rel="{ir_string(link, "rel") or ""}"'
        for link in ir_maps(response, "links")
        if isinstance(url := slots.get(ir_string(link, "role") or ""), str)
    ]

    if relations:
        headers.append((LINK, ", ".join(relations)))

    return tuple(headers)


def _add_numbered_slots(
    operation_id: str,
    style: IrMap,
    query: Mapping[str, object],
    raw_query: str,
    facts: Mapping[str, object],
    item_count: int,
    limit: int | None,
    slots: dict[str, object],
) -> None:
    """A page or offset position: the boundary counts the page, its records and the URLs from the request."""
    if limit is None or limit <= 0:
        raise BoundaryFailureError(f"seampact: the list '{operation_id}' has no limit; regenerate the api.")

    position = ir_string(style, "position")
    is_page = position == _PAGE
    position_role = _position_role(style)
    position_param = ir_string(position_role, "name") or ""
    base = ir_int(position_role, "base")
    base = _DEFAULT_PAGE_BASE if base is None else base
    sent = query.get(position_param)

    if is_page:
        page_number = sent if _is_int(sent) else base
        slots[_PAGE] = page_number
        page_index = page_number - base
        offset = min(page_index * limit, _INT64_MAX)
    else:
        offset = sent if _is_int(sent) else _FIRST_OFFSET
        page_index = offset // limit

    slots[_OFFSET] = offset
    total = facts.get(_TOTAL)
    # A position past the last int64 offset has no next page and no record numbers, as on every target.
    next_fits = offset <= _INT64_MAX - limit
    has_next = next_fits and (
        facts.get(_MORE) is True
        if _MORE in ir_strings(style, "handlerResult")
        else _is_int(total) and offset + limit < total
    )

    if item_count > 0 and offset <= _INT64_MAX - item_count:
        slots["from"] = offset + 1
        slots["to"] = offset + item_count

    slots["first"] = _page_url(_with_query_member(raw_query, position_param, _position_at(position, base, 0, limit)))

    if offset > _FIRST_OFFSET:
        previous = str(base + page_index - 1) if is_page else str(max(offset - limit, _FIRST_OFFSET))
        slots["previous"] = _page_url(_with_query_member(raw_query, position_param, previous))

    if has_next:
        # An offset the client chose need not fall on a page start: the next page starts one limit further.
        following = _position_at(_PAGE, base, page_index + 1, limit) if is_page else str(offset + limit)
        slots["next"] = _page_url(_with_query_member(raw_query, position_param, following))

    total_pages = slots.get("totalPages")

    if _is_int(total_pages):
        last_index = max(total_pages - 1, 0)
        last = _position_at(position, base, last_index, limit)
        slots["last"] = _page_url(_with_query_member(raw_query, position_param, last))


def _add_token_slots(
    style: IrMap, raw_query: str, facts: Mapping[str, object], position: str | None, slots: dict[str, object]
) -> None:
    """A cursor or since position: the URLs carry the tokens the handler returned."""
    position_param = ir_string(_position_role(style), "name") or ""
    before_param = _role_name(style, _BEFORE_ROLE)
    removed = [position_param] if before_param is None else [position_param, before_param]
    without_position = _without_query_members(raw_query, removed)
    slots["first"] = _page_url(without_position)
    tokens = (
        [("next", position_param, facts.get("nextSince"))]
        if position == _SINCE
        else [
            ("next", position_param, facts.get("nextCursor")),
            ("previous", before_param or position_param, facts.get("previousCursor")),
        ]
    )

    for role, param, token in tokens:
        if isinstance(token, str):
            slots[role] = _page_url(_with_query_member(without_position, param, token))


def _position_at(position: str | None, base: int, index: int, limit: int) -> str:
    """The page number, or the offset, of the page at `index`."""
    return str(base + index if position == _PAGE else index * limit)


def _position_role(style: IrMap) -> IrMap:
    """A cursor style may carry its position in `after` and `before` instead of `cursor`."""
    position = ir_string(style, "position") or ""
    role = _role_of(style, position)

    if role is None and position == _CURSOR:
        role = _role_of(style, _AFTER_ROLE)

    if role is None:
        raise BoundaryFailureError(
            f"seampact: the paging style '{ir_string(style, 'id') or ''}' has no position role; regenerate the api."
        )

    return role


def _role_name(style: IrMap, role: str) -> str | None:
    return ir_string(_role_of(style, role), "name")


def _role_of(style: IrMap, role: str) -> IrMap | None:
    return next((declared for declared in ir_maps(style, "request") if ir_string(declared, "role") == role), None)


def _limit_of(contract: ApiContract, operation_id: str, style: IrMap, query: Mapping[str, object]) -> int | None:
    limit_param = _role_name(style, _LIMIT_ROLE)
    paging = ir_map(contract.operation(operation_id), "paging")

    if limit_param is None:
        return ir_int(paging, "defaultLimit")

    return _effective_limit(paging, query.get(limit_param))


def _effective_limit(paging: IrMap, sent: object) -> int | None:
    """The default for none sent, `maxLimit` for a larger one under `clamp`."""
    if not _is_int(sent):
        return ir_int(paging, "defaultLimit")

    max_limit = ir_int(paging, "maxLimit")

    if ir_string(paging, "overLimit") == _CLAMP and max_limit is not None and sent > max_limit:
        return max_limit

    return sent


def _without_query_members(raw_query: str, names: Sequence[str]) -> str:
    return "&".join(kept_query_pairs(raw_query, names))


def _with_query_member(raw_query: str, name: str, value: str) -> str:
    kept = _without_query_members(raw_query, [name])
    member = f"{component_encoded(name)}={component_encoded(value)}"

    return member if kept == "" else f"{kept}&{member}"


def _page_url(query: str) -> str:
    """A query-only reference (RFC 3986): it resolves against the URL the client called, so it keeps a path prefix a
    reverse proxy stripped. An empty query is `?`, since an empty reference would keep the called query."""
    return f"?{query}"


def _is_int(value: object) -> TypeGuard[int]:
    return isinstance(value, int) and not isinstance(value, bool)
