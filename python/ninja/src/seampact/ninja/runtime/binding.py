"""What `bind_<api>()` hands the runtime (ADR 0027 "Ninja", "Placement"): the api's binding, one `add_operation` per
contract operation with its view and handler call, then `bind_api`, which builds the api's `Router` with one
`api_operation()` per contract route, adds it to the app's `NinjaAPI`, wraps its `on_exception`, and registers the
binding as the api's run-time values, which the boundary and the boot check read."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Final

from django.http import HttpRequest
from ninja import NinjaAPI, Router

from seampact.codegen.runtime.access_kinds import access_kind
from seampact.codegen.runtime.access_steps import AccessHooks
from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError
from seampact.codegen.runtime.pydantic.contract_input import InputBuilder
from seampact.codegen.runtime.run_settings import OperationTypes, RunSettings
from seampact.django.runtime.api_configuration import register_configuration
from seampact.django.runtime.api_settings import is_idempotency_store
from seampact.hooks import (
    AuthenticateHook,
    DecideHook,
    IdempotencyStore,
    ResolveScopeHook,
    UnexpectedErrorListener,
    UnexpectedFailure,
)
from seampact.ninja.runtime.exceptions import recording_on_exception
from seampact.ninja.runtime.native_docs import complete_ninja_document
from seampact.ninja.runtime.placement import AccessSettings, ApiPlacement, Factory, OperationRoute
from seampact.ninja.runtime.preflight import PREFLIGHT_METHOD, unserved_preflight_view

_NO_ACCESS: Final = AccessSettings()


class BindingError(TypeError):
    """`bind_<api>()` was given a value it cannot use; the message names it and the fix."""


@dataclass(frozen=True, slots=True)
class BoundOperation:
    route: OperationRoute
    view: Callable[..., object]
    handlers: Factory[object] | None
    call: Callable[..., object]
    types: OperationTypes
    inputs: InputBuilder


@dataclass(slots=True, kw_only=True)
class ApiBinding:
    """The api's run-time values as `bind_<api>()` took them; the Django layer reads them as the api's
    configuration, and each hook factory builds its hook once per request."""

    placement: ApiPlacement
    contract: ApiContract
    api: NinjaAPI
    prefix: str
    authenticate: Mapping[str, Factory[AuthenticateHook]]
    deciders: Mapping[str, Factory[DecideHook]]
    scope_resolvers: Mapping[str, Factory[ResolveScopeHook]]
    idempotency_store_factory: Factory[IdempotencyStore] | None
    on_unexpected_error: Factory[UnexpectedErrorListener] | None
    access: Mapping[str, AccessSettings]
    settings: RunSettings
    operations: dict[str, BoundOperation] = field(default_factory=dict)
    on_exception: Callable[..., object] | None = None

    def access_hooks(self, request: HttpRequest) -> AccessHooks:
        return AccessHooks(
            authenticate={name: built(request) for name, built in self.authenticate.items()},
            deciders={name: built(request) for name, built in self.deciders.items()},
            scope_resolvers={name: built(request) for name, built in self.scope_resolvers.items()},
        )

    def unexpected_error_listener(self, request: HttpRequest) -> Callable[[UnexpectedFailure], object] | None:
        if self.on_unexpected_error is None:
            return None

        listener: UnexpectedErrorListener = self.on_unexpected_error(request)

        return listener.on_unexpected_error

    def idempotency_store(self, request: HttpRequest) -> IdempotencyStore | None:
        if self.idempotency_store_factory is None:
            return None

        store: object = self.idempotency_store_factory(request)

        if not is_idempotency_store(store):
            raise BoundaryFailureError(
                f"seampact: the idempotency_store factory of bind_{self.placement.api}() built a "
                f"{type(store).__qualname__}, which lacks begin, complete or abandon; return an IdempotencyStore."
            )

        return store

    def public_origin(self) -> object:
        return self.settings.public_origin

    def responses(self, operation_id: str) -> str | None:
        operation = self.settings.operations.get(operation_id)
        mode = (operation.responses if operation is not None else None) or self.settings.responses

        return None if mode is None else str(mode)


_bindings: dict[str, ApiBinding] = {}


def binding_of(api: str) -> ApiBinding | None:
    """The binding of the api, None until `bind_<api>()` ran."""
    return _bindings.get(api)


def api_binding(
    placement: ApiPlacement,
    contract: ApiContract,
    api: NinjaAPI,
    *,
    prefix: str,
    authenticate: Mapping[str, Factory[AuthenticateHook]],
    deciders: Mapping[str, Factory[DecideHook]],
    scope_resolvers: Mapping[str, Factory[ResolveScopeHook]],
    idempotency_store: Factory[IdempotencyStore] | None,
    on_unexpected_error: Factory[UnexpectedErrorListener] | None,
    access: Mapping[str, AccessSettings],
    settings: RunSettings,
) -> ApiBinding:
    """Raises `BindingError` when `api` is not a `NinjaAPI`, or when the api was already bound on it."""
    if not isinstance(api, NinjaAPI):
        raise BindingError(
            f"seampact: bind_{placement.api}() takes the app's NinjaAPI, not a {type(api).__qualname__}; pass the "
            "NinjaAPI whose urls the app includes."
        )

    earlier = binding_of(placement.api)

    if earlier is not None and earlier.api is api:
        raise BindingError(
            f"seampact: bind_{placement.api}() was already called on this NinjaAPI, and a second call would add the "
            "api's routes twice; call it once."
        )

    return ApiBinding(
        placement=placement,
        contract=contract,
        api=api,
        prefix=prefix,
        authenticate=dict(authenticate),
        deciders=dict(deciders),
        scope_resolvers=dict(scope_resolvers),
        idempotency_store_factory=idempotency_store,
        on_unexpected_error=on_unexpected_error,
        access=dict(access),
        settings=settings,
    )


def add_operation[E, R](
    binding: ApiBinding,
    operation_id: str,
    view: Callable[..., object],
    handlers: Factory[E] | None,
    call: Callable[[E, R], object],
    types: OperationTypes,
) -> None:
    """Records one contract operation: its route, its view, the factory of its endpoints and its handler call."""
    binding.operations[operation_id] = BoundOperation(
        binding.placement.route(operation_id),
        view,
        handlers,
        call,
        types,
        InputBuilder(binding.contract, operation_id, types),
    )


def bind_api(binding: ApiBinding) -> None:
    """Adds the api's Router to the app's NinjaAPI; each operation runs the `auth=` and throttles the app gave its
    access kind, none otherwise, so an app-wide `NinjaAPI(auth=...)` never reaches a contract route; each path also
    answers a CORS preflight no CORS layer answered with its 404, without `auth=` or throttles."""
    router = Router()

    for bound in binding.operations.values():
        kind = access_kind(binding.contract, bound.route.operation_id)
        settings = binding.access.get(kind, _NO_ACCESS)
        router.add_api_operation(
            bound.route.path,
            list(bound.route.methods),
            bound.view,
            auth=settings.auth,
            throttle=list(settings.throttle),
            include_in_schema=False,
            url_name=bound.route.name,
        )

    # One preflight view per contract path, under the path's URL name.
    for path_operation in {bound.route.path: bound for bound in binding.operations.values()}.values():
        preflight = unserved_preflight_view(binding.contract, binding.placement.views, path_operation.view)
        router.add_api_operation(
            path_operation.route.path,
            [PREFLIGHT_METHOD],
            preflight,
            auth=None,
            throttle=[],
            include_in_schema=False,
            url_name=path_operation.route.name,
        )

    binding.api.add_router(binding.prefix, router)

    if binding.placement.native_docs is not None:
        complete_ninja_document(binding.api, binding.placement, binding.placement.native_docs)

    binding.on_exception = recording_on_exception(binding.api)
    _bindings[binding.placement.api] = binding
    register_configuration(binding.placement.api, binding)
