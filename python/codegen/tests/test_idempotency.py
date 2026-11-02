"""Idempotency at the boundary: the claim's key and fingerprint as every target derives them, the store's answers,
and the reply kept for a replay."""

import asyncio
from dataclasses import dataclass, field

import pytest

from seampact.codegen.runtime.access_steps import HookCaller
from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError, ContractRefusal
from seampact.codegen.runtime.idempotency import (
    IdempotencyClaimed,
    IdempotencyReplayed,
    IdempotencyStoreFailure,
    begin_idempotency,
    idempotency_fingerprint,
    idempotency_partition_key,
    settle_idempotency,
)
from seampact.codegen.runtime.input_decoding import DecodedInput
from seampact.codegen.runtime.replies import Reply
from seampact.hooks import IdempotencyBegin, IdempotencyClaim, StoredResponse, idempotency_begin

_CREATE_TASK = "createTask"
_KEY_HEADER = "Idempotency-Key"


@dataclass(frozen=True, slots=True)
class _Principal:
    user_id: str


@dataclass
class _Store:
    """Answers `answer` to every claim, and records what the boundary asks of it."""

    answer: IdempotencyBegin
    failing: bool = False
    claims: list[IdempotencyClaim] = field(default_factory=list)
    completed: list[tuple[str, StoredResponse]] = field(default_factory=list)
    abandoned: list[str] = field(default_factory=list)

    async def begin(self, claim: IdempotencyClaim, /) -> IdempotencyBegin:
        self.claims.append(claim)
        return self.answer

    async def complete(self, key: str, response: StoredResponse, /) -> None:
        if self.failing:
            raise ConnectionError("the store is down")

        self.completed.append((key, response))

    async def abandon(self, key: str, /) -> None:
        self.abandoned.append(key)


def _input(headers: dict[str, object], title: str = "Write the docs") -> DecodedInput:
    return DecodedInput({"channelId": "c1"}, {}, headers, {"title": title}, None)


def _begin(
    contract: ApiContract, store: _Store | None, call: HookCaller, decoded: DecodedInput
) -> IdempotencyClaimed | IdempotencyReplayed | None:
    return asyncio.run(begin_idempotency(contract, _CREATE_TASK, None, decoded, store, call))


def test_the_partition_key_digests_as_on_the_node_targets(tasks_contract: ApiContract) -> None:
    key = idempotency_partition_key(tasks_contract, _CREATE_TASK, None, "key-1")

    assert key == "0e9711dfe19de9076c70514c7d5204e8816596cd427904fc6d562b0bbbc20cb4"


def test_two_principals_never_share_a_key(tasks_contract: ApiContract) -> None:
    alice = idempotency_partition_key(tasks_contract, _CREATE_TASK, _Principal("alice"), "key-1")
    bob = idempotency_partition_key(tasks_contract, _CREATE_TASK, _Principal("bob"), "key-1")

    assert alice != bob


def test_a_retry_with_new_credentials_and_key_matches_and_another_body_does_not(tasks_contract: ApiContract) -> None:
    first = idempotency_fingerprint(tasks_contract, _CREATE_TASK, _input({_KEY_HEADER: "k1", "Authorization": "a"}))
    retried = idempotency_fingerprint(tasks_contract, _CREATE_TASK, _input({_KEY_HEADER: "k2", "Authorization": "b"}))
    other = idempotency_fingerprint(tasks_contract, _CREATE_TASK, _input({_KEY_HEADER: "k1"}, title="Other"))

    assert first == retried
    assert first != other


def test_a_started_claim_carries_the_lifetime_and_holds_the_key(
    tasks_contract: ApiContract, hook_caller: HookCaller
) -> None:
    store = _Store(idempotency_begin.Started())

    begun = _begin(tasks_contract, store, hook_caller, _input({_KEY_HEADER: "key-1"}))

    assert isinstance(begun, IdempotencyClaimed)
    assert store.claims[0].key == begun.key
    assert store.claims[0].lifetime_ms == 86400000


def test_a_request_without_a_key_claims_nothing(tasks_contract: ApiContract, hook_caller: HookCaller) -> None:
    store = _Store(idempotency_begin.Started())

    assert _begin(tasks_contract, store, hook_caller, _input({})) is None
    assert store.claims == []


@pytest.mark.parametrize(
    ("answer", "code"),
    [
        pytest.param(idempotency_begin.Running(), "api.idempotency_in_progress", id="running"),
        pytest.param(idempotency_begin.Mismatch(), "api.idempotency_key_reused", id="mismatch"),
    ],
)
def test_a_running_or_reused_key_is_refused_with_its_role(
    tasks_contract: ApiContract, hook_caller: HookCaller, answer: IdempotencyBegin, code: str
) -> None:
    with pytest.raises(ContractRefusal) as refused:
        _begin(tasks_contract, _Store(answer), hook_caller, _input({_KEY_HEADER: "key-1"}))

    assert refused.value.code == code


def test_a_replayed_success_carries_the_replay_header(tasks_contract: ApiContract, hook_caller: HookCaller) -> None:
    stored = StoredResponse(
        status=201, headers=(StoredResponse.Header(name="content-type", value="application/json"),), body=b"{}"
    )

    begun = _begin(
        tasks_contract, _Store(idempotency_begin.Replay(response=stored)), hook_caller, _input({_KEY_HEADER: "k"})
    )

    assert isinstance(begun, IdempotencyReplayed)
    assert begun.reply == Reply(201, (("content-type", "application/json"), ("idempotency-replayed", "true")), b"{}")
    assert "{}" not in repr(begun)


def test_a_key_without_a_store_fails_the_boundary(tasks_contract: ApiContract, hook_caller: HookCaller) -> None:
    with pytest.raises(BoundaryFailureError, match="no idempotency store"):
        _begin(tasks_contract, None, hook_caller, _input({_KEY_HEADER: "key-1"}))


def test_a_success_is_kept_with_its_contract_headers_only(tasks_contract: ApiContract, hook_caller: HookCaller) -> None:
    store = _Store(idempotency_begin.Started())
    reply = Reply(201, (("content-type", "application/json"), ("set-cookie", "session=s")), b'{"id":"t1"}')

    failure = asyncio.run(
        settle_idempotency(tasks_contract, _CREATE_TASK, IdempotencyClaimed("k"), reply, store, hook_caller)
    )

    assert failure is None
    assert [(key, response.status, response.body) for key, response in store.completed] == [("k", 201, b'{"id":"t1"}')]
    assert [header.name for header in store.completed[0][1].headers] == ["content-type"]


@pytest.mark.parametrize(
    "reply",
    [
        pytest.param(Reply(500, (), b"{}"), id="server error"),
        pytest.param(Reply(429, (("cache-control", "private, no-store"),), b"{}"), id="no-store error"),
    ],
)
def test_a_server_error_or_a_no_store_error_releases_the_key(
    tasks_contract: ApiContract, hook_caller: HookCaller, reply: Reply
) -> None:
    store = _Store(idempotency_begin.Started())

    asyncio.run(settle_idempotency(tasks_contract, _CREATE_TASK, IdempotencyClaimed("k"), reply, store, hook_caller))

    assert store.abandoned == ["k"]
    assert store.completed == []


def test_a_store_failure_after_the_reply_goes_back_to_the_placement(
    tasks_contract: ApiContract, hook_caller: HookCaller
) -> None:
    store = _Store(idempotency_begin.Started(), failing=True)

    failure = asyncio.run(
        settle_idempotency(
            tasks_contract, _CREATE_TASK, IdempotencyClaimed("k"), Reply(201, (), b""), store, hook_caller
        )
    )

    assert isinstance(failure, IdempotencyStoreFailure)
    assert isinstance(failure.cause, ConnectionError)
