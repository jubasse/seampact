"""The successor link and the version tag a success writes, as every target writes them: each path param stays one
encoded segment, and a version that is no safe integer or entity tag text is the boundary's failure."""

import pytest

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError
from seampact.codegen.runtime.ir_view import IrJson
from seampact.codegen.runtime.response_headers import derived_response_headers, successor_link

_TEXT: IrJson = {"kind": "scalar", "refinements": {}, "type": "string"}
_ORIGIN: IrJson = {"layer": "api", "pointer": "/surfaces/app/routes/notes/concurrency"}


def _notes_contract() -> ApiContract:
    """`updateNote` versioned by `If-Match` on `revision`, its 200 writing the version's ETag."""
    ir_view: dict[str, IrJson] = {
        "api": {"id": "notes"},
        "operations": [
            {
                "id": "updateNote",
                "method": "patch",
                "path": "/v1/notes/{noteId}",
                "concurrency": {
                    "field": "revision",
                    "version": {"in": "header", "name": "If-Match"},
                    "derivedFrom": {"derivation": "concurrency.version", "from": [_ORIGIN]},
                },
                "responses": [
                    {
                        "status": 200,
                        "headers": [
                            {
                                "name": "ETag",
                                "type": _TEXT,
                                "required": True,
                                "derivedFrom": {"derivation": "concurrency.version", "from": [_ORIGIN]},
                            }
                        ],
                    }
                ],
            }
        ],
    }

    return ApiContract(
        api="notes", generated_by="0.0.0-dev", mount="", ir_view=ir_view, members={}, operation_members={}
    )


def _entity_tag(revision: object) -> tuple[str, str] | None:
    contract = _notes_contract()
    response = contract.operation("updateNote")["responses"]
    assert isinstance(response, list) and isinstance(response[0], dict)

    return derived_response_headers(contract, "updateNote", response[0], {"revision": revision}, {}).entity_tag


@pytest.mark.parametrize(
    ("raw", "segment"),
    [("a%20b%2F%C3%A9", "a%20b%2F%C3%A9"), ("x%0D%0AInjected:%20y", "x%0D%0AInjected%3A%20y"), ("a%252F", "a%252F")],
)
def test_a_successor_link_param_stays_one_encoded_segment(raw: str, segment: str) -> None:
    link = successor_link("/v1/notes/{noteId}", "successor-version", {"noteId": raw})

    assert link == f'</v1/notes/{segment}>; rel="successor-version"'


@pytest.mark.parametrize("revision", [7, 2**53 - 1, "r7"])
def test_a_safe_integer_or_entity_tag_text_is_the_version_tag(revision: object) -> None:
    assert _entity_tag(revision) == ("etag", f'"{revision}"')


@pytest.mark.parametrize("revision", [2**53, -(2**63), True, 1.0, "1\r\nX: y", 'a"b', None])
def test_a_version_that_is_no_safe_integer_or_tag_text_is_the_boundarys_failure(revision: object) -> None:
    with pytest.raises(BoundaryFailureError, match="revision"):
        _entity_tag(revision)
