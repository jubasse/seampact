"""The boot check's hook problems on the reference contract: each identity, scope and decider the operations call
and the app did not register is named once, with the placement's fix."""

import json
from pathlib import Path

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.hook_check import HookFixes, hook_needs, hook_problems

_FIXES = HookFixes(authenticate="register it", decider="add a decider", scope_resolver="add a resolver")


def _tasks(repository_root: Path) -> ApiContract:
    ir_view = json.loads((repository_root / "fixtures/golden/reference/tasks.ir.json").read_text(encoding="utf-8"))

    return ApiContract(
        api="tasks", generated_by="0.0.0-dev", mount="", ir_view=ir_view, members={}, operation_members={}
    )


def test_every_registered_hook_leaves_no_problem(repository_root: Path) -> None:
    contract = _tasks(repository_root)
    needs = hook_needs(contract)

    problems = hook_problems(
        contract, identities=needs.identities, scopes=needs.scopes, deciders=needs.deciders, fixes=_FIXES
    )

    assert needs.identities
    assert needs.scopes
    assert needs.deciders
    assert problems == []


def test_each_missing_hook_is_named_once_with_its_fix(repository_root: Path) -> None:
    contract = _tasks(repository_root)
    needs = hook_needs(contract)

    problems = hook_problems(
        contract, identities=needs.identities[1:], scopes=needs.scopes[1:], deciders=needs.deciders[1:], fixes=_FIXES
    )

    assert problems == [
        f"no authenticate hook for the identity '{needs.identities[0]}': register it",
        f"no scope resolver for the scope '{needs.scopes[0]}': add a resolver",
        f"no decider for '{needs.deciders[0]}': add a decider",
    ]


def test_the_hooks_of_chosen_operations_are_those_they_call(repository_root: Path) -> None:
    needs = hook_needs(_tasks(repository_root), ["health"])

    assert (needs.identities, needs.scopes, needs.deciders) == ([], [], [])
