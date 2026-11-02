"""The Ninja part of the boot check (ADR 0027 "The system check and the boot check"): the api's values come from
`bind_<api>()`, so the check reads them from the binding: a missing call, a missing handler factory, the hooks the
contract needs, the idempotency store, the per-operation settings, the access kinds, the public origin, an
`on_exception` replaced after the call, and in sync views an `async def` factory or method."""

import inspect
from collections.abc import Callable, Collection, Mapping
from typing import Final

from seampact.codegen.runtime.access_kinds import ACCESS_KINDS, access_kind
from seampact.codegen.runtime.hook_check import HookFixes, hook_needs, hook_problems
from seampact.codegen.runtime.idempotency import enforces_idempotency
from seampact.codegen.runtime.public_origin import public_origin_problem
from seampact.django.runtime.api_settings import SETTINGS_NAME, SettingsError, api_settings
from seampact.django.runtime.boot_check import async_methods, built_classes
from seampact.ninja.runtime.binding import ApiBinding, binding_of
from seampact.ninja.views_mode import ViewsMode

_HOOK_METHODS: Final = {"authenticate": "authenticate", "deciders": "decide", "scope_resolvers": "resolve_scope"}


def binding_problems(api: str, body_validation: bool) -> list[str]:
    """Every problem of the values `bind_<api>()` took; a `settings.SEAMPACT` entry for the api is refused, since
    nothing reads it."""
    problems = _settings_entry_problems(api)
    binding = binding_of(api)

    if binding is None:
        return [
            *problems,
            f"the api '{api}' is not bound: call bind_{api}(api, prefix=..., handlers=...) in the module that builds "
            "the NinjaAPI the root URLconf includes.",
        ]

    if body_validation or binding.settings.body_validation:
        problems.append(
            f"the api '{api}' sets bodyValidation, which this release of seampact-ninja does not serve yet; remove "
            "the option until a release serves it."
        )

    problems += _handler_problems(binding)
    problems += _operation_settings_problems(binding)
    problems += _access_problems(binding)
    problems += _store_problems(binding)
    problems += _on_exception_problems(binding)
    origin = public_origin_problem(binding.contract, f"bind_{api}(public_origin=...)", binding.settings.public_origin)

    return problems if origin is None else [*problems, f"{origin}."]


def binding_hook_problems(api: str) -> list[str]:
    """The hooks the contract needs that `bind_<api>()` was not given, then those it was given in vain."""
    binding = binding_of(api)

    if binding is None:
        return []

    contract = binding.contract
    needs = hook_needs(contract)
    problems = hook_problems(
        contract,
        identities=list(binding.authenticate),
        scopes=list(binding.scope_resolvers),
        deciders=list(binding.deciders),
        fixes=HookFixes(
            authenticate=f"pass its factory in bind_{api}(authenticate={{...}})",
            decider=f"pass its factory in bind_{api}(deciders={{...}})",
            scope_resolver=f"pass its factory in bind_{api}(scope_resolvers={{...}})",
        ),
    )
    given: dict[str, tuple[Mapping[str, Callable[..., object]], Collection[str]]] = {
        "authenticate": (binding.authenticate, needs.identities),
        "deciders": (binding.deciders, needs.deciders),
        "scope_resolvers": (binding.scope_resolvers, needs.scopes),
    }

    for argument, (factories, needed) in given.items():
        problems += [
            f"bind_{api}({argument}=...) names '{name}', which the contract does not use; remove it."
            for name in factories
            if name not in needed
        ]

        for name, factory in factories.items():
            problems += _sync_view_problems(binding, f"{argument}['{name}']", factory, _HOOK_METHODS[argument])

    return problems


def _settings_entry_problems(api: str) -> list[str]:
    try:
        own = api_settings(api)
    except SettingsError as broken:
        return [str(broken)]

    if not own:
        return []

    return [
        f"settings.{SETTINGS_NAME}['{api}'] is set, and the api takes its values from bind_{api}(); remove the "
        "settings entry and pass its values to that call."
    ]


def _handler_problems(binding: ApiBinding) -> list[str]:
    api = binding.placement.api
    problems: list[str] = []
    factories: dict[int, tuple[str, Callable[..., object]]] = {}

    for operation_id in binding.contract.operation_ids():
        bound = binding.operations.get(operation_id)

        if bound is None or bound.handlers is None:
            problems.append(
                f"operation '{operation_id}' has no handler factory: pass its endpoints' factory in the handlers of "
                f"bind_{api}()."
            )
        else:
            factories.setdefault(id(bound.handlers), (operation_id, bound.handlers))

    for operation_id, factory in factories.values():
        problems += _sync_view_problems(binding, f"the handlers of '{operation_id}'", factory, None)

    return problems


def _operation_settings_problems(binding: ApiBinding) -> list[str]:
    kept = set(binding.contract.operation_ids())

    return [
        f"bind_{binding.placement.api}(operations=...) names the operation '{operation_id}', which the api does not "
        "keep; remove it, or correct its operation id."
        for operation_id in binding.settings.operations
        if operation_id not in kept
    ]


def _access_problems(binding: ApiBinding) -> list[str]:
    api, contract = binding.placement.api, binding.contract
    used = {access_kind(contract, operation_id) for operation_id in contract.operation_ids()}
    problems: list[str] = []

    for kind in binding.access:
        if kind not in ACCESS_KINDS:
            problems.append(
                f"bind_{api}(access=...) has the unknown access kind '{kind}'; the kinds are {', '.join(ACCESS_KINDS)}."
            )
        elif kind not in used:
            problems.append(
                f"bind_{api}(access=...) names the access kind '{kind}', which no operation of the api has; remove it."
            )

    return problems


def _store_problems(binding: ApiBinding) -> list[str]:
    api, contract = binding.placement.api, binding.contract
    enforced = [
        operation_id for operation_id in contract.operation_ids() if enforces_idempotency(contract, operation_id)
    ]

    if binding.idempotency_store_factory is None:
        return [
            f"operation '{operation_id}' replays its idempotent requests and the api has no store: pass its factory "
            f"in bind_{api}(idempotency_store=...)."
            for operation_id in enforced
        ]

    if not enforced:
        return [f"bind_{api}(idempotency_store=...) names a store, which no operation of the contract uses; remove it."]

    return _sync_view_problems(binding, "idempotency_store", binding.idempotency_store_factory, "begin")


def _on_exception_problems(binding: ApiBinding) -> list[str]:
    if binding.api.on_exception is binding.on_exception:
        return []

    return [
        f"the NinjaAPI's on_exception was replaced after bind_{binding.placement.api}(), so the boundary no longer "
        f"hears of Ninja's exceptions; replace it before that call."
    ]


def _sync_view_problems(
    binding: ApiBinding, argument: str, factory: Callable[..., object], hook_method: str | None
) -> list[str]:
    """In sync views, an `async def` factory, or a built class whose hook method (or any public handler method) is an
    `async def`."""
    if binding.placement.views is not ViewsMode.SYNC:
        return []

    api = binding.placement.api

    if inspect.iscoroutinefunction(factory):
        return [f"bind_{api}() gets the async def factory {argument}; the api's views are sync, so write it as a def."]

    return [
        f"bind_{api}() gets {argument}, which builds a {built_class.__qualname__} whose method '{method}' is an async "
        "def; the api's views are sync, so write it as a plain def, or generate with `views: async`."
        for built_class in built_classes(factory)
        for method in async_methods(built_class, hook_method)
    ]
