"""The query pairs a page link keeps, encoded as every target encodes them."""

import pytest

from seampact.codegen.runtime.wire_values import component_encoded, kept_query_pairs, link_safe, list_items


@pytest.mark.parametrize(
    ("text", "encoded"),
    [
        pytest.param("a b/ü!*'()~", "a%20b%2F%C3%BC!*'()~", id="unreserved and marks kept"),
        pytest.param("c2=&?#", "c2%3D%26%3F%23", id="delimiters encoded"),
        pytest.param("Ω→x", "%CE%A9%E2%86%92x", id="multibyte"),
    ],
)
def test_a_component_is_encoded_as_encode_uri_component_does(text: str, encoded: str) -> None:
    assert component_encoded(text) == encoded


# A raw query is its bytes read one to one as text, so `é` sent as UTF-8 arrives as the two characters `Ã©`.
@pytest.mark.parametrize(
    ("pair", "safe"),
    [
        pytest.param("q=a,b;c:d@e/f?g", "q=a,b;c:d@e/f?g", id="query characters kept"),
        pytest.param("q=%41%2c", "q=%41%2c", id="an escape kept"),
        pytest.param("q=100%", "q=100%25", id="a lone percent encoded"),
        pytest.param("q=%4", "q=%254", id="a percent before one hex digit encoded"),
        pytest.param('q=<"x">', "q=%3C%22x%22%3E", id="angle brackets and quotes encoded"),
        pytest.param("q=Ã© x", "q=%C3%A9%20x", id="raw bytes encoded"),
    ],
)
def test_a_kept_pair_is_link_safe(pair: str, safe: str) -> None:
    assert link_safe(pair) == safe


def test_a_raw_query_cannot_add_a_link_relation() -> None:
    kept = kept_query_pairs('limit=1&q=a>;rel="evil",<https://evil.example/&cursor=c1', ["cursor"])

    assert kept == ["limit=1", "q=a%3E;rel=%22evil%22,%3Chttps://evil.example/"]
    assert ">" not in "&".join(kept)


def test_an_unexploded_list_splits_on_raw_commas_only_then_decodes_each_item() -> None:
    unexploded = {"kind": "list", "explode": False}

    assert list_items(["createdAt%2CcreatedAt"], unexploded) == ["createdAt,createdAt"]
    assert list_items(["a,b%20c"], unexploded) == ["a", "b c"]
    assert list_items(["a%2Cb"], None) == ["a,b"]
