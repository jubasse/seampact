"""The contract routes of one api (ADR 0026 "Placement" and "Routes"): one `add_api_route` per operation on the api's
own router, named `seampact.<api>.<operationId>`, left out of FastAPI's document. The access dependency sits in the
route's `dependencies` and runs steps 2 to 5 after the app's global and router dependencies; the endpoint takes only
the `Request`, the input dependency (steps 6 to 8, which depends on the access dependency) and the handler factory, in
that order, so FastAPI parses no parameter and the input is checked before the factory opens a session."""

import inspect
from collections.abc import Awaitable, Callable, Mapping
from typing import Annotated, Final, TypeGuard
from urllib.parse import quote

import fastapi

from seampact.codegen.runtime.access_steps import AccessHooks, AccessState, headers_view, run_access_steps
from seampact.codegen.runtime.contract import NOT_FOUND_ROLE
from seampact.codegen.runtime.failures import BoundaryFailureError, ContractRefusal
from seampact.codegen.runtime.handler_reply import ReplyContext, result_reply
from seampact.codegen.runtime.hook_check import hook_needs
from seampact.codegen.runtime.idempotency import enforces_idempotency
from seampact.codegen.runtime.public_origin import configured_origin
from seampact.codegen.runtime.pydantic.contract_input import InputBuilder
from seampact.codegen.runtime.run_settings import OperationTypes
from seampact.fastapi.runtime.api_binding import ApiBinding, is_unexpected_error_listener
from seampact.fastapi.runtime.handler_call import call_handler
from seampact.fastapi.runtime.input_features import featured_input
from seampact.fastapi.runtime.placement import Factory, OperationRoute
from seampact.fastapi.runtime.request_state import RequestState, state_of
from seampact.hooks import (
    AuthenticateHook,
    DecideHook,
    IdempotencyStore,
    RequestView,
    ResolveScopeHook,
    UnexpectedErrorListener,
)

_ROOT_PATH_SAFE: Final = "/"
_AUTHENTICATE: Final = "authenticate"
_DECIDER: Final = "decider"
_SCOPE_RESOLVER: Final = "scope_resolver"
_LISTENER: Final = "on_unexpected_error"
_IDEMPOTENCY_STORE: Final = "idempotency_store"
_IF_NONE_MATCH: Final = "if-none-match"


def add_operation[E, R](
    binding: ApiBinding,
    operation_id: str,
    handlers: Factory[E] | None,
    invoke: Callable[[E, R], Awaitable[object]],
    types: OperationTypes,
) -> None:
    """Adds the contract route of `operation_id` to the api's router, its endpoint calling `invoke` with the handlers
    `handlers` builds; a missing factory answers the api's 500, and the boot check names it."""
    route = binding.placement.route(operation_id)
    access = _access_dependency(binding, route)
    contract_input = _input_dependency(binding, route, access, InputBuilder(binding.contract, operation_id, types))
    binding.handler_factories[operation_id] = handlers
    binding.dependencies += [access, contract_input]

    binding.router.add_api_route(
        route.path,
        _endpoint(binding, route, handlers, invoke, contract_input, types),
        methods=list(route.methods),
        name=route.name,
        include_in_schema=False,
        dependencies=[fastapi.Depends(access)],
        response_class=fastapi.Response,
    )


def _access_dependency(binding: ApiBinding, route: OperationRoute) -> Callable[..., Awaitable[None]]:
    """Steps 2 to 5. Its hook factories are its sub-dependencies, so they run first, as the app's native layer."""
    needs = hook_needs(binding.contract, [route.operation_id])
    hook_factories: dict[str, tuple[str, str, Factory[object]]] = {}

    def depend(kind: str, name: str, factory: Factory[object] | None) -> None:
        if factory is not None:
            hook_factories[f"{kind}_{len(hook_factories)}"] = (kind, name, factory)

    for identity in needs.identities:
        depend(_AUTHENTICATE, identity, binding.hooks.authenticate.get(identity))

    for scope in needs.scopes:
        depend(_SCOPE_RESOLVER, scope, binding.hooks.scope_resolvers.get(scope))

    for name in needs.deciders:
        depend(_DECIDER, name, binding.hooks.deciders.get(name))

    depend(_LISTENER, "", binding.hooks.on_unexpected_error)

    if enforces_idempotency(binding.contract, route.operation_id):
        depend(_IDEMPOTENCY_STORE, "", binding.hooks.idempotency_store)

    async def access(request: fastapi.Request, **resolved: object) -> None:
        state = _contract_state(binding, request, route.operation_id)
        hooks, listener, store = _resolved_hooks(hook_factories, resolved)
        state.listener = listener
        state.hooks = hooks
        state.idempotency_store = store
        access_state = AccessState(
            contract=binding.contract,
            operation_id=route.operation_id,
            credentials_types=binding.placement.credentials,
            raw_parameters=state.raw_parameters,
            request=_request_view(request, state),
            body=state.decoded.body,
            raw_body=state.decoded.raw_body,
        )

        await run_access_steps(access_state, hooks, call_handler)

        state.access = access_state
        state.admitted = True

    parameters = [inspect.Parameter("request", inspect.Parameter.POSITIONAL_OR_KEYWORD, annotation=fastapi.Request)]
    parameters += [
        inspect.Parameter(name, inspect.Parameter.KEYWORD_ONLY, default=fastapi.Depends(factory))
        for name, (_, _, factory) in hook_factories.items()
    ]
    # FastAPI reads the dependency's parameters from its signature: one sub-dependency per hook factory it needs.
    setattr(access, "__signature__", inspect.Signature(parameters))  # noqa: B010
    access.__name__ = f"seampact_{binding.api}_{route.operation_id}_access"

    return access


def _contract_state(binding: ApiBinding, request: fastapi.Request, operation_id: str) -> RequestState:
    """The boundary's state of this request: without it the boundary did not run, so the route fails closed; a raw
    path that matched another operation than the route FastAPI chose answers that path's 404."""
    state = state_of(request.scope, binding.api)

    if state is None:
        raise BoundaryFailureError(
            f"seampact: the contract route of operation '{operation_id}' ran without the '{binding.api}' boundary; "
            f"call bind_{binding.api}() on the app that serves the route, and add no ASGI layer that drops the scope."
        )

    if state.operation_id != operation_id:
        code = binding.contract.role_code(state.operation_id, NOT_FOUND_ROLE)

        if code is None:
            raise BoundaryFailureError(
                f"seampact: operation '{state.operation_id}' declares no code for the role '{NOT_FOUND_ROLE}'."
            )

        raise ContractRefusal(binding.api, code)

    return state


def _resolved_hooks(
    hook_factories: Mapping[str, tuple[str, str, Factory[object]]], resolved: Mapping[str, object]
) -> tuple[AccessHooks, UnexpectedErrorListener | None, IdempotencyStore | None]:
    authenticate: dict[str, AuthenticateHook] = {}
    deciders: dict[str, DecideHook] = {}
    scope_resolvers: dict[str, ResolveScopeHook] = {}
    listener: UnexpectedErrorListener | None = None
    store: IdempotencyStore | None = None

    for parameter, (kind, name, _) in hook_factories.items():
        hook = resolved.get(parameter)

        if kind == _AUTHENTICATE and _is_authenticate_hook(hook):
            authenticate[name] = hook
        elif kind == _DECIDER and _is_decide_hook(hook):
            deciders[name] = hook
        elif kind == _SCOPE_RESOLVER and _is_scope_resolver(hook):
            scope_resolvers[name] = hook
        elif kind == _LISTENER and is_unexpected_error_listener(hook):
            listener = hook
        elif kind == _IDEMPOTENCY_STORE and _is_idempotency_store(hook):
            store = hook
        else:
            raise BoundaryFailureError(
                f"seampact: the {kind.replace('_', ' ')} factory for '{name}' built a {type(hook).__qualname__}, "
                "which lacks the hook's method; return an object that implements the hook protocol."
            )

    hooks = AccessHooks(authenticate=authenticate, deciders=deciders, scope_resolvers=scope_resolvers)

    return hooks, listener, store


def _is_authenticate_hook(value: object) -> TypeGuard[AuthenticateHook]:
    return callable(getattr(value, "authenticate", None))


def _is_decide_hook(value: object) -> TypeGuard[DecideHook]:
    return callable(getattr(value, "decide", None))


def _is_scope_resolver(value: object) -> TypeGuard[ResolveScopeHook]:
    return callable(getattr(value, "resolve_scope", None))


def _is_idempotency_store(value: object) -> TypeGuard[IdempotencyStore]:
    return all(callable(getattr(value, method, None)) for method in ("begin", "complete", "abandon"))


def _link_path(request: fastapi.Request, state: RequestState) -> str:
    """The path a page link names: the mount prefix the boundary removed, then the contract path."""
    return quote(str(request.scope.get("root_path", "")), safe=_ROOT_PATH_SAFE) + state.target.path


def _request_view(request: fastapi.Request, state: RequestState) -> RequestView:
    client = request.client

    return RequestView(
        method=state.method,
        path=state.target.path,
        headers=headers_view(request.headers.raw),
        client_address=None if client is None else client.host,
    )


def _input_dependency(
    binding: ApiBinding, route: OperationRoute, access: Callable[..., Awaitable[None]], builder: InputBuilder
) -> Callable[..., Awaitable[object]]:
    """Steps 6 to 8 on the boundary's decoded tree; without the access mark for its own operation it fails closed."""

    async def contract_input(request: fastapi.Request, admitted: Annotated[None, fastapi.Depends(access)]) -> object:
        state = state_of(request.scope, binding.api)

        if (
            state is None
            or state.operation_id != route.operation_id
            or not state.admitted
            or state.access is None
            or state.hooks is None
        ):
            raise BoundaryFailureError(
                f"seampact: the input of operation '{route.operation_id}' was asked for before its access steps "
                "admitted the request; remove any dependency override of the generated dependencies."
            )

        typed = await featured_input(state, state.access, state.hooks, builder)
        state.typed_request = typed

        return typed

    contract_input.__name__ = f"seampact_{binding.api}_{route.operation_id}_input"

    return contract_input


def _endpoint[E, R](
    binding: ApiBinding,
    route: OperationRoute,
    handlers: Factory[E] | None,
    invoke: Callable[[E, R], Awaitable[object]],
    contract_input: Callable[..., Awaitable[object]],
    types: OperationTypes,
) -> Callable[..., Awaitable[fastapi.Response]]:
    handler_factory: Factory[object] = handlers if handlers is not None else _missing_handler(binding, route)

    async def endpoint(
        request: fastapi.Request,
        contract_request: Annotated[R, fastapi.Depends(contract_input)],
        endpoints: Annotated[E, fastapi.Depends(handler_factory)],
    ) -> fastapi.Response:
        state = state_of(request.scope, binding.api)

        if state is None or state.typed_request is not contract_request or state.access is None or state.hooks is None:
            raise BoundaryFailureError(
                f"seampact: the endpoint of operation '{route.operation_id}' got an input its input dependency did "
                "not build; remove any dependency override of the generated dependencies."
            )

        result = await invoke(endpoints, contract_request)
        context = ReplyContext(
            access=state.access,
            hooks=state.hooks,
            call=call_handler,
            query=state.input_query,
            raw_query=state.target.query,
            path=_link_path(request, state),
            if_none_match=request.headers.get(_IF_NONE_MATCH),
            public_origin=configured_origin(binding.contract, binding.settings.public_origin),
        )
        reply = state.authored.author(await result_reply(binding.contract, route.operation_id, types, result, context))

        return fastapi.Response(content=reply.body, status_code=reply.status, headers=dict(reply.headers))

    endpoint.__name__ = f"seampact_{binding.api}_{route.operation_id}"

    return endpoint


def _missing_handler(binding: ApiBinding, route: OperationRoute) -> Callable[[], object]:
    def missing() -> object:
        raise BoundaryFailureError(
            f"seampact: the '{binding.api}' api has no handler factory for operation '{route.operation_id}'; pass one "
            f"in the handlers of bind_{binding.api}()."
        )

    return missing
