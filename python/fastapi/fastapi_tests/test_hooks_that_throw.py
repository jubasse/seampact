"""A hook that throws (ADR 0012): the authenticate hook, a scope resolver or a decider raising answers the api's 500
through the boundary, no handler runs, the failure reaches the unexpected-error listener and the thrown message stays
out of the reply."""

import uuid
from typing import Final

import pytest
from fastapi.testclient import TestClient

from seampact.hooks import UnexpectedFailure

from .golden_app import HOOK_FAILURE, AllowingHooks, served_with_every_hook

_CHANNEL_PATH: Final = f"/v1/channels/{uuid.UUID(int=7)}"

failures: list[UnexpectedFailure] = []


class _Listener:
    def on_unexpected_error(self, failure: UnexpectedFailure, /) -> None:
        failures.append(failure)


@pytest.fixture(autouse=True)
def _clean() -> None:
    failures.clear()


@pytest.mark.parametrize(
    ("hook", "operation", "method", "path"),
    [
        ("authenticate", "getChannel", "get", _CHANNEL_PATH),
        ("resolve_scope", "getChannel", "get", _CHANNEL_PATH),
        ("decide", "createTask", "post", f"{_CHANNEL_PATH}/tasks"),
    ],
)
def test_a_hook_that_throws_answers_the_apis_500_before_any_handler(
    hook: str, operation: str, method: str, path: str
) -> None:
    hooks = AllowingHooks()
    hooks.throwing = hook
    # No lifespan: the golden api's other hooks are not wired, and `served` passes the boot check by hand.
    client = TestClient(served_with_every_hook(hooks, listener=_Listener), raise_server_exceptions=False)

    response = client.request(
        method,
        path,
        headers={"Authorization": "Bearer user", "Idempotency-Key": "k-1"},
        json={"title": "Write the guide"} if method == "post" else None,
    )

    assert response.status_code == 500
    assert response.json()["code"] == "api.internal"
    assert [failure.operation for failure in failures] == [operation]
    assert [str(failure.cause) for failure in failures] == [HOOK_FAILURE]
    assert HOOK_FAILURE not in response.text
