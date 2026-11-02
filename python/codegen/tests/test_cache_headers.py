"""The cache headers of a success: `Cache-Control` by caller kind, `Vary`, and the strong ETag with its 304."""

import copy
import dataclasses

from seampact.codegen.runtime.cache_headers import strong_etag, with_cache_headers
from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.digests import canonical
from seampact.codegen.runtime.ir_view import IrJson
from seampact.codegen.runtime.replies import Reply

_GET_PREFERENCES = "getPreferences"
_BODY = b'{"locale":"fr"}'
_JSON = ("content-type", "application/json")


def _cached(contract: ApiContract, if_none_match: str | None) -> Reply:
    return with_cache_headers(contract, _GET_PREFERENCES, Reply(200, (_JSON,), _BODY), "alice", if_none_match)


def test_the_etag_is_the_body_digest_every_target_writes() -> None:
    value = {"b": 1.5, "a": [1e21, 1e-7, 0.000001, -2, 100], "Z": True, "_": None, "é": 'line\nbreak\u0001"q"'}

    assert strong_etag(canonical([value]).encode("utf-8")) == '"hBgVa5l-FcLKzWrjqm4aC8OmbProbI7KcUcWD86bxCA"'


def test_an_identified_success_gets_the_private_directives_vary_and_its_etag(tasks_contract: ApiContract) -> None:
    reply = _cached(tasks_contract, None)

    assert reply.status == 200
    assert reply.body == _BODY
    assert reply.header("cache-control") == "private, max-age=60"
    assert reply.header("vary") == "Authorization, Cookie"
    assert reply.header("etag") == strong_etag(_BODY)


def test_a_matching_if_none_match_answers_304_without_body_or_content_type(tasks_contract: ApiContract) -> None:
    for if_none_match in (strong_etag(_BODY), f'"other", W/{strong_etag(_BODY)}', "*"):
        reply = _cached(tasks_contract, if_none_match)

        assert reply.status == 304
        assert reply.body == b""
        assert reply.header("content-type") is None
        assert reply.header("etag") == strong_etag(_BODY)


def test_another_tag_keeps_the_success(tasks_contract: ApiContract) -> None:
    assert _cached(tasks_contract, '"other"').status == 200


def test_an_operation_without_cache_is_left_as_is(tasks_contract: ApiContract) -> None:
    reply = Reply(200, (_JSON,), _BODY)

    assert with_cache_headers(tasks_contract, "getTask", reply, "alice", "*") is reply


def test_a_header_the_operation_does_not_write_is_kept(tasks_contract: ApiContract) -> None:
    ir_view: dict[str, IrJson] = copy.deepcopy(dict(tasks_contract.ir_view))
    operations = ir_view["operations"]
    assert isinstance(operations, list)
    preferences = next(op for op in operations if isinstance(op, dict) and op["id"] == _GET_PREFERENCES)
    assert isinstance(preferences, dict) and isinstance(preferences["cache"], dict)
    preferences["cache"]["etag"] = False
    contract = dataclasses.replace(tasks_contract, ir_view=ir_view)

    reply = with_cache_headers(contract, _GET_PREFERENCES, Reply(200, (_JSON, ("etag", '"v7"')), _BODY), "alice", None)

    assert reply.header("etag") == '"v7"'
    assert reply.header("vary") == "Authorization, Cookie"
