"""An `HTTPException` a handler raises on a contract route (ADR 0026 "Exceptions on contract routes") is answered with
the code of its status's role when the operation declares one, with `Retry-After` carried as `retryAfterMs`; a status
whose role the operation declares no code for is the api's 500, logged."""

import copy
import dataclasses
from collections.abc import Callable
from typing import Final

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from seampact.codegen.runtime.ir_view import IrJson
from seampact.fastapi.runtime import ApiBinding

from .golden_app import AllowingHooks, served_with_every_hook

_CREATE_PATH: Final = "/v1/channels/00000000-0000-0000-0000-000000000007/tasks"
_STATUS_OF_NO_ROLE: Final = 418


def _raising(status: int, headers: dict[str, str] | None = None) -> type:
    class Tasks:
        def create_task(self, request: object, /) -> object:
            raise HTTPException(status, headers=headers)

    return Tasks


def _binding_the_wait_to_the_rate_limited_role(app: FastAPI) -> None:
    """The golden `createTask` binds no params on its `rateLimited` role: this gives it `{retryAfterMs}`."""
    binding = app.user_middleware[0].kwargs["binding"]
    assert isinstance(binding, ApiBinding)
    ir_view: dict[str, IrJson] = copy.deepcopy(dict(binding.contract.ir_view))
    operations = ir_view["operations"]
    assert isinstance(operations, list)
    create_task = next(op for op in operations if isinstance(op, dict) and op["id"] == "createTask")
    assert isinstance(create_task, dict)
    errors = create_task["errors"]
    assert isinstance(errors, list)
    rate_limited = next(error for error in errors if isinstance(error, dict) and error["code"] == "api.rate_limited")
    assert isinstance(rate_limited, dict)
    rate_limited["roles"] = [
        {
            "role": "rateLimited",
            "params": {
                "kind": "object",
                "members": [
                    {
                        "name": {"kind": "text", "text": "retryAfterMs"},
                        "value": {"kind": "slot", "slot": "retryAfterMs", "path": []},
                    }
                ],
            },
        }
    ]
    binding.contract = dataclasses.replace(binding.contract, ir_view=ir_view)


def _create_task(
    status: int, headers: dict[str, str] | None = None, prepare: Callable[[FastAPI], None] | None = None
) -> tuple[int, dict[str, object]]:
    app = served_with_every_hook(AllowingHooks(), handlers={"tasks": _raising(status, headers)})

    if prepare is not None:
        prepare(app)

    client = TestClient(app, raise_server_exceptions=False)
    response = client.post(
        _CREATE_PATH, headers={"Authorization": "Bearer user", "Idempotency-Key": "k-1"}, json={"title": "Write"}
    )

    return response.status_code, response.json()


def test_a_429_with_retry_after_answers_the_rate_limited_code_with_the_wait_in_milliseconds() -> None:
    status, body = _create_task(429, {"Retry-After": "3"}, _binding_the_wait_to_the_rate_limited_role)

    assert status == 429
    assert body["code"] == "api.rate_limited"
    assert body["retryAfterMs"] == 3000


def test_a_429_with_a_retry_after_that_is_not_whole_seconds_gives_no_wait_and_is_the_apis_500() -> None:
    status, body = _create_task(
        429, {"retry-after": "Wed, 21 Oct 2026 07:28:00 GMT"}, _binding_the_wait_to_the_rate_limited_role
    )

    assert (status, body["code"]) == (500, "api.internal")


def test_a_code_that_requires_params_the_role_binds_none_for_is_the_apis_500_and_is_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    status, body = _create_task(429, {"Retry-After": "3"})

    assert (status, body["code"]) == (500, "api.internal")
    assert "the code 'api.rate_limited' requires params the exception does not give" in caplog.text


def test_a_status_whose_role_the_operation_declares_no_code_for_is_the_apis_500_and_is_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    status, body = _create_task(503)

    assert (status, body["code"]) == (500, "api.internal")
    assert "took the role 'serviceUnavailable', and the operation declares no code for it" in caplog.text


def test_a_status_with_no_role_is_left_to_the_outgoing_check() -> None:
    status, body = _create_task(_STATUS_OF_NO_ROLE)

    assert (status, body["code"]) == (500, "api.internal")
