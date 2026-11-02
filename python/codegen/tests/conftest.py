"""Fixtures shared by the tests of `seampact-codegen`: the repository the golden IRs live in, the reference contracts
as the runtime reads them, and a hook caller that awaits what a hook returns."""

import inspect
import json
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Final

import pytest

from seampact.codegen.runtime.access_steps import HookCaller
from seampact.codegen.runtime.contract import ApiContract

# python/codegen/tests/conftest.py: the repository root is three directories up from this one.
_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="session")
def repository_root() -> Path:
    return _REPOSITORY_ROOT


# The member table of the `tasks` principal, as the generated principal type holds it.
TASKS_MEMBERS: Final = {"UserPrincipal": {"userId": "user_id"}}


def _reference_contract(api: str, members: Mapping[str, Mapping[str, str]]) -> ApiContract:
    ir_view = json.loads((_REPOSITORY_ROOT / f"fixtures/golden/reference/{api}.ir.json").read_text(encoding="utf-8"))

    return ApiContract(
        api=api, generated_by="0.0.0-dev", mount="", ir_view=ir_view, members=members, operation_members={}
    )


@pytest.fixture(scope="session")
def tasks_contract() -> ApiContract:
    """The reference `tasks` api, its principal's member table set."""
    return _reference_contract("tasks", TASKS_MEMBERS)


@pytest.fixture(scope="session")
def tasks_service_contract() -> ApiContract:
    return _reference_contract("tasksService", {})


class _AwaitingCaller:
    async def __call__[A, T](self, method: Callable[[A], T | Awaitable[T]], argument: A, /) -> T:
        result = method(argument)

        if inspect.isawaitable(result):
            return await result

        return result


@pytest.fixture(scope="session")
def hook_caller() -> HookCaller:
    return _AwaitingCaller()
