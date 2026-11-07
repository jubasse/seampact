"""Fixtures shared by the tests of `seampact-codegen`: the repository the golden IRs live in, the reference contracts
as the runtime reads them, and a hook caller that awaits what a hook returns."""

import importlib.util
import inspect
import json
from collections.abc import Awaitable, Callable, Mapping, Sequence
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


# The member tables of the `tasks` principal and of its params schemas, as the generated types hold them.
TASKS_MEMBERS: Final = {
    "UserPrincipal": {"userId": "user_id"},
    "RolesParams": {"allowed": "allowed"},
    "RecentAuthParams": {"intent": "intent"},
}
_TASKS_PARAMS: Final = ("RolesParams", "RecentAuthParams")
_GOLDEN_SCHEMAS: Final = Path(__file__).resolve().parent / "golden/reference/tasks/schemas.py"


def _golden_params_models(names: Sequence[str]) -> dict[str, type]:
    """The params classes of the Pydantic emitter's golden `tasks` schemas, as a generated contract holds them."""
    spec = importlib.util.spec_from_file_location("tasks_golden_schemas", _GOLDEN_SCHEMAS)

    if spec is None or spec.loader is None:
        raise LookupError(f"The golden schemas module {_GOLDEN_SCHEMAS} cannot be loaded; regenerate the goldens.")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    models = {name: getattr(module, name) for name in names}

    return {name: model for name, model in models.items() if isinstance(model, type)}


def _reference_contract(
    api: str, members: Mapping[str, Mapping[str, str]], params_models: Mapping[str, type]
) -> ApiContract:
    ir_view = json.loads((_REPOSITORY_ROOT / f"fixtures/golden/reference/{api}.ir.json").read_text(encoding="utf-8"))

    return ApiContract(
        api=api,
        generated_by="0.0.0-dev",
        mount="",
        ir_view=ir_view,
        members=members,
        operation_members={},
        params_models=params_models,
    )


@pytest.fixture(scope="session")
def tasks_contract() -> ApiContract:
    """The reference `tasks` api, its principal's member table set."""
    return _reference_contract("tasks", TASKS_MEMBERS, _golden_params_models(_TASKS_PARAMS))


@pytest.fixture(scope="session")
def tasks_service_contract() -> ApiContract:
    return _reference_contract("tasksService", {}, {})


class _AwaitingCaller:
    async def __call__[A, T](self, method: Callable[[A], T | Awaitable[T]], argument: A, /) -> T:
        result = method(argument)

        if inspect.isawaitable(result):
            return await result

        return result


@pytest.fixture(scope="session")
def hook_caller() -> HookCaller:
    return _AwaitingCaller()
