"""The hook problems of the boot check (ADR 0016 "The boot check"): an identity without its authenticate hook, a scope
without its resolver, a right or rule without a decider. Each problem names the hook and ends with the fix the
placement gives, since each framework registers hooks its own way."""

from collections.abc import Collection
from dataclasses import dataclass

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.ir_view import ir_map, ir_maps, ir_string


@dataclass(frozen=True, slots=True, kw_only=True)
class HookFixes:
    """How the app registers each kind of hook, ending a problem line."""

    authenticate: str
    decider: str
    scope_resolver: str


@dataclass(frozen=True, slots=True, kw_only=True)
class HookNeeds:
    """The hook names the api's operations call, in first-use order."""

    identities: list[str]
    scopes: list[str]
    deciders: list[str]


def hook_needs(contract: ApiContract, operation_ids: Collection[str] | None = None) -> HookNeeds:
    """The hooks the given operations call, every operation of the api by default."""
    needs = HookNeeds(identities=[], scopes=[], deciders=[])

    for operation_id in contract.operation_ids() if operation_ids is None else operation_ids:
        operation = contract.operation(operation_id)
        _add(needs.identities, ir_string(ir_map(operation, "access"), "identity"))

        for scope in ir_maps(operation, "scopes"):
            _add(needs.scopes, ir_string(scope, "scope"))

        for requirement in ir_maps(operation, "requires"):
            _add(needs.deciders, ir_string(requirement, "right") or ir_string(requirement, "rule"))

        for field_right in ir_maps(operation, "fieldRights"):
            _add(needs.deciders, ir_string(field_right, "right"))

    return needs


def hook_problems(
    contract: ApiContract,
    *,
    identities: Collection[str],
    scopes: Collection[str],
    deciders: Collection[str],
    fixes: HookFixes,
) -> list[str]:
    """The problem lines of the hooks the app did not register, given the names it registered."""
    needs = hook_needs(contract)
    problems = [
        f"no authenticate hook for the identity '{identity}': {fixes.authenticate}"
        for identity in needs.identities
        if identity not in identities
    ]
    problems += [
        f"no scope resolver for the scope '{scope}': {fixes.scope_resolver}"
        for scope in needs.scopes
        if scope not in scopes
    ]
    problems += [f"no decider for '{name}': {fixes.decider}" for name in needs.deciders if name not in deciders]

    return problems


def _add(names: list[str], name: str | None) -> None:
    if name is not None and name not in names:
        names.append(name)
