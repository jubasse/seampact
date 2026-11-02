"""Step 1's decoding of a contract request on the reference contract's `createTask`: the bounded body read, the
media type and the JSON tree."""

import asyncio
import gzip
import json
import zlib
from collections.abc import AsyncIterator, Sequence
from pathlib import Path

import pytest

from seampact.codegen.runtime.body_reader import (
    PAYLOAD_TOO_LARGE_ROLE,
    SCHEMA_INVALID_ROLE,
    UNSUPPORTED_MEDIA_TYPE_ROLE,
    BodyRead,
    read_body,
)
from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import ContractRefusal
from seampact.codegen.runtime.input_decoding import DecodedInput, IncomingRequest, decode_input
from seampact.codegen.runtime.raw_target import RawTarget

_CREATE_TASK = "createTask"
_JSON = "application/json"


@pytest.fixture(scope="module")
def tasks(repository_root: Path) -> ApiContract:
    ir_view = json.loads((repository_root / "fixtures/golden/reference/tasks.ir.json").read_text(encoding="utf-8"))

    return ApiContract(api="tasks", generated_by="0.0.0-dev", mount="", ir_view=ir_view, members={})


async def _chunks(parts: Sequence[bytes]) -> AsyncIterator[bytes]:
    for part in parts:
        yield part


def _decode(tasks: ApiContract, body: bytes, headers: dict[str, str] | None = None) -> DecodedInput:
    request = IncomingRequest(
        method="POST",
        target=RawTarget("/v1/channels/c1/tasks", "", raw=True),
        headers={"content-type": _JSON, "content-length": str(len(body))} if headers is None else headers,
        body=_chunks([body]),
    )

    return asyncio.run(decode_input(tasks, _CREATE_TASK, {"channelId": "c1"}, request))


def _issues(refusal: ContractRefusal) -> object:
    return None if refusal.params is None else refusal.params.get("issues")


def test_a_lone_surrogate_in_a_string_value_refuses_the_body(tasks: ApiContract) -> None:
    with pytest.raises(ContractRefusal) as refused:
        _decode(tasks, b'{"title": "a\\ud800"}')

    assert _issues(refused.value) == [{"pointer": "", "rule": "type"}]


def test_a_lone_surrogate_in_a_key_is_left_for_the_unknown_key_report(tasks: ApiContract) -> None:
    decoded = _decode(tasks, b'{"\\ud800": 1}')

    assert decoded.body == {"\ud800": 1}


def _read(parts: Sequence[bytes], declared_length: str | None, coding: str | None, limit_bytes: int) -> BodyRead:
    return asyncio.run(read_body(_chunks(parts), declared_length, coding, limit_bytes))


_BOMB = gzip.compress(b"0" * 100_000)


@pytest.mark.parametrize(
    ("parts", "declared_length", "coding", "limit_bytes", "expected"),
    [
        ([b"ab", b"cd"], None, None, 4, BodyRead(b"abcd")),
        ([b"abcd"], "4", "identity", 4, BodyRead(b"abcd")),
        ([gzip.compress(b"abcd")], None, "GZIP", 100, BodyRead(b"abcd")),
        ([zlib.compress(b"abcd")], None, "deflate", 100, BodyRead(b"abcd")),
        ([gzip.compress(b"a" * 50)], None, "gzip", 40, BodyRead(b"", PAYLOAD_TOO_LARGE_ROLE)),
        ([b"abcde"], None, None, 4, BodyRead(b"", PAYLOAD_TOO_LARGE_ROLE)),
        ([b"ab", b"cde"], None, None, 4, BodyRead(b"", PAYLOAD_TOO_LARGE_ROLE)),
        ([], "5", None, 4, BodyRead(b"", PAYLOAD_TOO_LARGE_ROLE)),
        ([_BOMB], None, "gzip", 1_000, BodyRead(b"", PAYLOAD_TOO_LARGE_ROLE)),
        ([b"abcd"], None, "br", 4, BodyRead(b"", UNSUPPORTED_MEDIA_TYPE_ROLE)),
        ([b"not gzip"], None, "gzip", 100, BodyRead(b"", SCHEMA_INVALID_ROLE)),
        ([gzip.compress(b"abcd")[:-4]], None, "gzip", 100, BodyRead(b"", SCHEMA_INVALID_ROLE)),
    ],
)
def test_the_body_read_is_bounded_and_decoded(
    parts: Sequence[bytes], declared_length: str | None, coding: str | None, limit_bytes: int, expected: BodyRead
) -> None:
    assert _read(parts, declared_length, coding, limit_bytes) == expected


def test_a_body_read_never_shows_its_bytes() -> None:
    assert "secret" not in repr(BodyRead(b"secret"))


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        (b'{"title": "a", "effort": 1.0}', {"title": "a", "effort": 1.0}),
        (b'{"title": "a", "title": "b"}', {"title": "b"}),
        (b"[]", []),
        (b'{"title": "\\ud83d\\ude00"}', {"title": "\U0001f600"}),
    ],
)
def test_a_json_body_decodes_to_its_tree(tasks: ApiContract, body: bytes, expected: object) -> None:
    assert _decode(tasks, body).body == expected


@pytest.mark.parametrize(
    "body",
    [
        b'{"effort": NaN}',
        b'{"effort": Infinity}',
        b'{"title": ',
        b"\xff",
        b"[" * 513 + b"]" * 513,
    ],
)
def test_a_body_that_is_not_json_or_too_deep_is_refused_whole(tasks: ApiContract, body: bytes) -> None:
    with pytest.raises(ContractRefusal) as refused:
        _decode(tasks, body)

    assert _issues(refused.value) == [{"pointer": "", "rule": "type"}]


def test_a_body_nested_at_the_depth_limit_decodes(tasks: ApiContract) -> None:
    assert _decode(tasks, b"[" * 512 + b"]" * 512).body is not None


@pytest.mark.parametrize(
    "headers",
    [
        {"content-type": "text/plain", "content-length": "2"},
        {"content-length": "2"},
        {"content-type": _JSON, "content-length": "2", "content-encoding": "br"},
    ],
)
def test_a_body_of_another_media_type_or_coding_is_refused(tasks: ApiContract, headers: dict[str, str]) -> None:
    with pytest.raises(ContractRefusal) as refused:
        _decode(tasks, b"{}", headers)

    assert refused.value.code == tasks.role_code(_CREATE_TASK, UNSUPPORTED_MEDIA_TYPE_ROLE)


def test_a_body_past_the_limit_is_refused_before_its_media_type(tasks: ApiContract) -> None:
    with pytest.raises(ContractRefusal) as refused:
        _decode(tasks, b"{}", {"content-type": "text/plain", "content-length": str(2**30)})

    assert refused.value.code == tasks.role_code(_CREATE_TASK, PAYLOAD_TOO_LARGE_ROLE)


def test_a_request_without_a_body_decodes_to_none(tasks: ApiContract) -> None:
    assert _decode(tasks, b"", {"content-type": _JSON}).body is None
