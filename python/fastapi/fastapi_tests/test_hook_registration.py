"""The neutral hooks of the FastAPI placement: one registration per concern (authenticate, decide, resolve scope) in
`bind_<api>()`, and a boot check that names each hook the contract calls and the app did not register."""

import importlib
from collections.abc import Callable
from typing import Final

import fastapi

from seampact.codegen.runtime.hook_check import hook_needs
from seampact.fastapi.runtime import ApiBinding
from seampact.fastapi.runtime.boot_check import boot_problems

_GOLDEN_API: Final = "fastapi_tests.golden.reference.tasks"
_NO_HOOK_PREFIXES: Final = ("no authenticate hook", "no scope resolver", "no decider")


def _binding(**hooks: dict[str, Callable[[], object]]) -> ApiBinding:
    placement = importlib.import_module(f"{_GOLDEN_API}.fastapi")
    handlers = placement.TasksHandlerFactories(
        tasks=object, drafts=object, channels=object, preferences=object, app=object, hooks=object
    )
    app = fastapi.FastAPI()
    placement.bind_tasks(app, handlers=handlers, **hooks)
    binding = app.user_middleware[0].kwargs["binding"]
    assert isinstance(binding, ApiBinding)

    return binding


def _hook_problems(binding: ApiBinding) -> list[str]:
    return [problem for problem in boot_problems(binding) if problem.startswith(_NO_HOOK_PREFIXES)]


def test_the_boot_check_names_each_hook_the_contract_calls_and_the_app_did_not_register() -> None:
    needs = hook_needs(_binding().contract)

    assert needs.identities
    assert needs.scopes
    assert needs.deciders
    assert _hook_problems(_binding()) == [
        *(
            f"no authenticate hook for the identity '{name}': pass its factory in `authenticate=` of bind_tasks()"
            for name in needs.identities
        ),
        *(
            f"no scope resolver for the scope '{name}': pass its factory in `scope_resolvers=` of bind_tasks()"
            for name in needs.scopes
        ),
        *(f"no decider for '{name}': pass its factory in `deciders=` of bind_tasks()" for name in needs.deciders),
    ]


def test_a_hook_registered_per_concern_by_name_leaves_no_hook_problem() -> None:
    needs = hook_needs(_binding().contract)
    binding = _binding(
        authenticate={name: object for name in needs.identities},
        deciders={name: object for name in needs.deciders},
        scope_resolvers={name: object for name in needs.scopes},
    )

    assert _hook_problems(binding) == []
