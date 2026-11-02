"""The page counts and links the boundary writes, as every target writes them."""

from typing import Final

import pytest

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError
from seampact.codegen.runtime.ir_view import IrJson
from seampact.codegen.runtime.page_reply import PageParts, filled_page_query, page_parts

_LIST_CHANNELS: Final = "listChannels"


def _slot(name: str) -> IrJson:
    return {"kind": "slot", "slot": name, "path": []}


def _member(name: str, slot: str) -> IrJson:
    return {"name": {"kind": "text", "text": name}, "value": _slot(slot)}


def _pages_contract(urls: str = "relative") -> ApiContract:
    """One list on a page style that counts its pages and links the last one."""
    ir_view: dict[str, IrJson] = {
        "api": {"id": "tasks", "wire": {"urls": urls}},
        "operations": [
            {
                "id": _LIST_CHANNELS,
                "paging": {"style": "pages", "defaultLimit": 2, "maxLimit": 100, "overLimit": "clamp"},
            }
        ],
        "pagings": {
            "pages": {
                "id": "pages",
                "position": "page",
                "absent": "omit",
                "request": [
                    {"role": "page", "in": "query", "name": "page", "base": 1},
                    {"role": "limit", "in": "query", "name": "per_page"},
                ],
                "response": {
                    "body": {
                        "kind": "object",
                        "members": [
                            _member("lastPage", "totalPages"),
                            _member("first", "first"),
                            _member("previous", "previous"),
                            _member("next", "next"),
                            _member("last", "last"),
                        ],
                    },
                    "meta": [],
                    "headers": [],
                    "links": [],
                },
                "handlerResult": ["total"],
            }
        },
    }

    return ApiContract(
        api="tasks", generated_by="0.0.0-dev", mount="", ir_view=ir_view, members={}, operation_members={}
    )


def _pages(query: dict[str, object], raw_query: str, items: list[object], total: int) -> PageParts:
    return page_parts(_pages_contract(), _LIST_CHANNELS, query, raw_query, items, {"total": total}, 200, "/v1/channels")


def test_an_empty_list_counts_no_page_and_its_last_link_is_the_first_page() -> None:
    parts = _pages({}, "per_page=2", [], 0)

    assert parts.body == {"lastPage": 0, "first": "?per_page=2&page=1", "last": "?per_page=2&page=1"}


def test_a_middle_page_links_its_neighbours_and_the_last_page() -> None:
    parts = _pages({"page": 2, "per_page": 2}, "page=2&per_page=2", ["c3", "c4"], 5)

    assert parts.body == {
        "lastPage": 3,
        "first": "?per_page=2&page=1",
        "previous": "?per_page=2&page=1",
        "next": "?per_page=2&page=3",
        "last": "?per_page=2&page=3",
    }


def test_the_handler_gets_the_default_limit_and_a_clamped_one() -> None:
    contract = _pages_contract()

    assert filled_page_query(contract, _LIST_CHANNELS, {}) == {"per_page": 2}
    assert filled_page_query(contract, _LIST_CHANNELS, {"per_page": 500}) == {"per_page": 100}


def test_a_cursor_page_links_the_next_token_and_keeps_the_other_query_pairs(tasks_contract: ApiContract) -> None:
    parts = page_parts(
        tasks_contract,
        _LIST_CHANNELS,
        {"limit": 10, "cursor": "abc"},
        "limit=10&cursor=abc&q=a%20b",
        [{"id": "c1"}],
        {"nextCursor": "n/1"},
        200,
        "/v1/channels",
    )

    assert parts.body == [{"id": "c1"}]
    assert parts.headers == (("link", '<?limit=10&q=a%20b&cursor=n%2F1>; rel="next"'),)


def test_absolute_urls_are_refused_by_name() -> None:
    with pytest.raises(BoundaryFailureError, match="absolute URLs"):
        page_parts(_pages_contract("absolute"), _LIST_CHANNELS, {}, "", [], {"total": 0}, 200, "/v1/channels")
