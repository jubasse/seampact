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


def test_a_page_past_the_last_int64_offset_links_no_next_page() -> None:
    last_page = 2**63 - 1
    parts = _pages({"page": last_page, "per_page": 100}, f"page={last_page}&per_page=100", ["c1"], 2**70)

    assert isinstance(parts.body, dict)
    assert "next" not in parts.body


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


def test_absolute_urls_start_with_the_public_origin_and_the_request_path() -> None:
    parts = page_parts(
        _pages_contract("absolute"),
        _LIST_CHANNELS,
        {"page": 2, "per_page": 2},
        "page=2&per_page=2",
        ["c3", "c4"],
        {"total": 5},
        200,
        "/v1/channels",
        public_origin="https://api.example.com:8443",
    )

    assert isinstance(parts.body, dict)
    assert parts.body["previous"] == "https://api.example.com:8443/v1/channels?per_page=2&page=1"
    assert parts.body["next"] == "https://api.example.com:8443/v1/channels?per_page=2&page=3"


def test_absolute_urls_without_a_public_origin_are_the_boundarys_failure_naming_the_setting() -> None:
    with pytest.raises(BoundaryFailureError, match=r"absolute URLs.*set public_origin"):
        page_parts(_pages_contract("absolute"), _LIST_CHANNELS, {}, "", [], {"total": 0}, 200, "/v1/channels")


def test_a_public_origin_under_relative_urls_is_the_boundarys_failure() -> None:
    with pytest.raises(BoundaryFailureError, match="relative URLs"):
        page_parts(
            _pages_contract(),
            _LIST_CHANNELS,
            {},
            "",
            [],
            {"total": 0},
            200,
            "/v1/channels",
            public_origin="https://api.example.com",
        )


def test_an_absolute_link_percent_encodes_the_request_path_so_a_segment_adds_no_link_relation() -> None:
    parts = page_parts(
        _pages_contract("absolute"),
        _LIST_CHANNELS,
        {"page": 1, "per_page": 2},
        "page=1&per_page=2",
        ["c1", "c2"],
        {"total": 3},
        200,
        '/v1/a>; rel="evil",b/caf%C3%A9 x',
        public_origin="https://api.example.com",
    )

    assert isinstance(parts.body, dict)
    assert parts.body["next"] == (
        "https://api.example.com/v1/a%3E%3B%20rel%3D%22evil%22%2Cb/caf%C3%A9%20x?per_page=2&page=2"
    )
