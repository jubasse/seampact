"""Step 1's decoding of a contract request on the reference contract's `createTask`: the bounded body read, the
media type and the JSON tree."""

import asyncio
import json
from collections.abc import AsyncIterator, Sequence
from pathlib import Path

import pytest

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

    assert _issues(refused.value) == [{"in": "body", "pointer": "", "rule": "type"}]


def test_a_lone_surrogate_in_a_key_is_left_for_the_unknown_key_report(tasks: ApiContract) -> None:
    decoded = _decode(tasks, b'{"\\ud800": 1}')

    assert decoded.body == {"\ud800": 1}
