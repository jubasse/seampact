"""The Ninja placement at run time, on the reference contract's golden package: the boot check reads the handlers
and hooks from `bind_<api>()`, the route names reverse under the NinjaAPI's namespace, the contract views carry the
marks the boundary sets, Ninja still calls the wrapped `on_exception` and its auth refusal answers the operation's
code, Pydantic 1 is refused at boot, and the values of `bind_<api>()` the runtime cannot serve are refused by name."""

import asyncio
import dataclasses
import importlib
import json
import sys
import uuid
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from importlib import metadata
from types import MappingProxyType, ModuleType
from typing import Final

import pytest
from django.core.cache import cache
from django.http import HttpRequest, HttpResponse
from django.test import Client, RequestFactory, override_settings
from django.urls import URLPattern, clear_url_caches, get_resolver, path, re_path, reverse
from ninja import NinjaAPI
from ninja.security import HttpBearer
from ninja.throttling import AnonRateThrottle, AuthRateThrottle

from seampact.codegen.runtime.framework_routes import FrameworkRouteRule
from seampact.codegen.runtime.framework_versions import framework_version_problems
from seampact.codegen.runtime.hook_check import hook_needs
from seampact.django.runtime.boot_check import boot_problems
from seampact.hooks import (
    ErrorCodeWithParams,
    ResolvedScope,
    UnexpectedFailure,
    authenticate_result,
    decision,
    scope_resolution,
)
from seampact.ninja.runtime import AccessSettings, BindingError, OperationSettings, serve_operation_async
from seampact.ninja.runtime import binding as binding_module
from seampact.ninja.runtime import exceptions as exceptions_module
from seampact.ninja.runtime.exceptions import recording_on_exception

_GOLDEN_ROOT = "ninja_tests.golden.reference"
_GOLDEN = f"{_GOLDEN_ROOT}.tasks"
_URLCONF = "ninja_tests.seampact_bound_urls"
_SECRET: Final = "secret-token-xyz"


def _golden(module: str) -> ModuleType:
    return importlib.import_module(f"{_GOLDEN}.{module}")


@contextmanager
def _served(
    monkeypatch: pytest.MonkeyPatch,
    api: NinjaAPI,
    include_prefix: str = "",
    handlers: Mapping[str, object] = MappingProxyType({}),
    package: str = "tasks",
    **bind_values: object,
) -> Iterator[NinjaAPI]:
    """The golden api (`tasks`, or the async `tasks_service`) bound on `api`, served by a root URLconf of its own
    that includes `api.urls` at `include_prefix`; only the handler factories in `handlers` are given."""
    monkeypatch.setattr(binding_module, "_bindings", {})
    golden_package = f"{_GOLDEN_ROOT}.{package}"
    api_name = package.title().replace("_", "")
    placement = importlib.import_module(f"{golden_package}.ninja")
    factories_type = getattr(placement, f"{api_name}HandlerFactories")
    resources = [field.name for field in dataclasses.fields(factories_type)]
    factories = factories_type(**{resource: handlers.get(resource) for resource in resources})
    bind: Callable[..., None] = getattr(placement, f"bind_{package}")
    bind(api, prefix="", handlers=factories, **bind_values)
    urlconf = ModuleType(_URLCONF)
    urlconf.urlpatterns = [path(include_prefix, api.urls)]  # type: ignore[attr-defined]
    sys.modules[_URLCONF] = urlconf
    clear_url_caches()

    with override_settings(
        ROOT_URLCONF=_URLCONF, MIDDLEWARE=[f"{golden_package}.django.{api_name}Boundary"], ALLOWED_HOSTS=["testserver"]
    ):
        yield api

    clear_url_caches()
    del sys.modules[_URLCONF]


@pytest.fixture(autouse=True)
def _one_ninja_api_per_test(monkeypatch: pytest.MonkeyPatch) -> None:
    # Ninja 1.5 refuses a second NinjaAPI of one urls_namespace in a process; each test builds its own.
    monkeypatch.setenv("NINJA_SKIP_REGISTRY", "1")


@pytest.fixture
def bound_api(monkeypatch: pytest.MonkeyPatch) -> Iterator[NinjaAPI]:
    """The golden api bound on a fresh NinjaAPI, served by a root URLconf of its own; no handler or hook given."""
    with _served(monkeypatch, NinjaAPI(urls_namespace="seampact-runtime")) as api:
        yield api


def test_the_boot_check_reads_the_handlers_and_hooks_from_the_binding(bound_api: NinjaAPI) -> None:
    boundary = _golden("django").TasksBoundary
    problems = [*boundary.configuration_problems(), *boundary.hook_configuration_problems()]

    assert (
        "operation 'health' has no handler factory: pass its endpoints' factory in the handlers of bind_tasks()."
        in problems
    )
    assert (
        "no authenticate hook for the identity 'user': pass its factory in bind_tasks(authenticate={...})" in problems
    )


def test_the_boot_check_names_each_hook_the_contract_calls_and_bind_did_not_register(bound_api: NinjaAPI) -> None:
    boundary = _golden("django").TasksBoundary
    needs = hook_needs(boundary.contract)
    problems = boundary.hook_configuration_problems()

    assert needs.identities
    assert needs.scopes
    assert needs.deciders
    for identity in needs.identities:
        assert (
            f"no authenticate hook for the identity '{identity}': pass its factory in bind_tasks(authenticate={{...}})"
            in problems
        )
    for scope in needs.scopes:
        assert (
            f"no scope resolver for the scope '{scope}': pass its factory in bind_tasks(scope_resolvers={{...}})"
            in problems
        )
    for decider in needs.deciders:
        assert f"no decider for '{decider}': pass its factory in bind_tasks(deciders={{...}})" in problems


def test_an_api_never_bound_is_refused_by_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(binding_module, "_bindings", {})

    assert _golden("django").TasksBoundary.configuration_problems() == [
        "the api 'tasks' is not bound: call bind_tasks(api, prefix=..., handlers=...) in the module that builds the "
        "NinjaAPI the root URLconf includes."
    ]


def test_route_names_reverse_under_the_ninja_apis_namespace(bound_api: NinjaAPI) -> None:
    names = _golden("routes").TasksRouteNames
    kwargs = {"path_channel_id": "7", "path_task_id": "9"}

    assert reverse(f"{bound_api.urls_namespace}:{names.GET_TASK}", kwargs=kwargs) == "/v1/channels/7/tasks/9"


def test_the_contract_views_carry_the_boundarys_marks_once_the_urlconf_is_read(bound_api: NinjaAPI) -> None:
    boundary = _golden("django").TasksBoundary
    boundary.prepare_urlconf()
    view = get_resolver().resolve("/v1/health").func

    assert getattr(view, "login_required", True) is False
    assert getattr(view, "seampact_contract", None) is boundary.contract


def test_a_cors_preflight_no_cors_layer_answered_gets_the_paths_404_not_ninjas_405(bound_api: NinjaAPI) -> None:
    preflight = RequestFactory().options(
        "/v1/health", headers={"Origin": "https://app.example.com", "Access-Control-Request-Method": "GET"}
    )
    answered = get_resolver().resolve("/v1/health").func(preflight)

    assert answered.status_code == HTTPStatus.NOT_FOUND
    assert json.loads(answered.content)["code"] == "api.not_found"


def test_ninja_calls_the_wrapped_on_exception_for_an_auth_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    recorded: list[BaseException] = []
    monkeypatch.setattr(exceptions_module, "record_exception", lambda request, exception: recorded.append(exception))
    api = NinjaAPI(urls_namespace="seampact-on-exception")

    class Refusing(HttpBearer):
        def authenticate(self, request: object, token: str) -> None:
            return None

    @api.get("/guarded", auth=Refusing())
    def guarded(request: object) -> str:
        return "unreachable"

    recording_on_exception(api)
    patterns: list[URLPattern] = [entry for entry in api.urls[0] if isinstance(entry, URLPattern)]
    view: Callable[[HttpRequest], HttpResponse] = next(entry for entry in patterns if entry.name == "guarded").callback
    response = view(RequestFactory().get("/guarded"))

    assert response.status_code == 401
    assert [type(exception).__name__ for exception in recorded] == ["AuthenticationError"]


def test_pydantic_1_is_refused_at_boot(monkeypatch: pytest.MonkeyPatch) -> None:
    installed = metadata.version

    def version(package: str) -> str:
        return "1.10.21" if package == "pydantic" else installed(package)

    monkeypatch.setattr(metadata, "version", version)
    problems = framework_version_problems(_golden("django").TasksBoundary.frameworks, "tasks")

    assert [problem for problem in problems if "pydantic" in problem]


def test_the_boot_check_names_each_responses_operations_and_body_validation_value_it_cannot_use(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    operations = {"health": {"responses": "warn"}, "getPreferences": OperationSettings(responses="nope")}  # type: ignore[arg-type]
    api = NinjaAPI(urls_namespace="seampact-run-settings")

    with _served(monkeypatch, api, responses="enforce-typo", body_validation="no", operations=operations):
        problems = _golden("django").TasksBoundary.configuration_problems()

    assert "bind_tasks(responses=...) is 'enforce-typo'; set one of strict, warn." in problems
    assert "bind_tasks(operations=...)['health'] is a dict; set an OperationSettings." in problems
    assert "bind_tasks(operations=...)['getPreferences'].responses is 'nope'; set one of strict, warn." in problems
    assert "bind_tasks(body_validation=...) is 'no'; set True or False." in problems


def test_a_cors_preflight_never_runs_an_app_wide_throttle(monkeypatch: pytest.MonkeyPatch) -> None:
    cache.clear()
    api = NinjaAPI(urls_namespace="seampact-preflight-throttle", throttle=AnonRateThrottle("1/m"))

    with _served(monkeypatch, api):
        view = get_resolver().resolve("/v1/health").func
        statuses = [
            view(
                RequestFactory().options(
                    "/v1/health", headers={"Origin": "https://app.example.com", "Access-Control-Request-Method": "GET"}
                )
            ).status_code
            for _ in range(3)
        ]

    assert statuses == [HTTPStatus.NOT_FOUND] * 3


class _FailingApp:
    def health(self, request: object, /) -> object:
        raise RuntimeError(_SECRET)


def test_a_handler_exceptions_message_stays_out_of_every_log_outside_debug(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    api = NinjaAPI(urls_namespace="seampact-secret-log")
    # Only the health handler is given: the boot check would refuse the others.
    monkeypatch.setattr(_golden("django").TasksBoundary, "boot_check", False)

    with _served(monkeypatch, api, handlers={"app": lambda request: _FailingApp()}), override_settings(DEBUG=False):
        response = Client(raise_request_exception=False).get("/v1/health")

    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert response["Content-Type"].startswith("application/")
    assert "RuntimeError" in caplog.text
    assert _SECRET not in caplog.text


def test_an_include_prefix_off_the_mount_gets_ninjas_own_fix(monkeypatch: pytest.MonkeyPatch) -> None:
    boundary = _golden("django").TasksBoundary

    with _served(monkeypatch, NinjaAPI(urls_namespace="seampact-include-prefix"), include_prefix="api/"):
        problems = boot_problems(boundary)

    assert (
        "operation 'health': no URL pattern serves /v1/health (its pattern sits at /api/v1/health); include the "
        "NinjaAPI's urls at a prefix that, followed by bind_tasks(prefix=...), equals the entry's mount."
    ) in problems


def test_a_single_star_never_allow_lists_a_catch_all_pattern(monkeypatch: pytest.MonkeyPatch) -> None:
    boundary = _golden("django").TasksBoundary
    single_stars = ("/v1/channels/*", "/v1/channels/*/*")
    problems_by_rules = {}

    with _served(monkeypatch, NinjaAPI(urls_namespace="seampact-catch-all")):
        sys.modules[_URLCONF].urlpatterns += [  # type: ignore[attr-defined]
            path("v1/channels/files/<path:rest>", lambda request: HttpResponse()),
            re_path(r"^v1/channels/blobs/(?P<rest>.*)$", lambda request: HttpResponse()),
        ]
        clear_url_caches()

        for patterns in (single_stars, ("/v1/channels/**",)):
            rules = tuple(FrameworkRouteRule(path=pattern, method=None, reason="files") for pattern in patterns)
            monkeypatch.setattr(boundary, "framework_routes", rules)
            problems_by_rules[patterns] = [problem for problem in boot_problems(boundary) if "{*}" in problem]

    assert problems_by_rules[single_stars] == [
        f"the app pattern '{route}' sits under the api's base path '/v1' and is not a contract route; remove it, "
        "or allow-list it in the entry's frameworkRoutes with a reason and no method."
        for route in ("/v1/channels/files/{*}", "/v1/channels/blobs/{*}")
    ]
    assert problems_by_rules[("/v1/channels/**",)] == []


def test_a_second_bind_on_the_same_ninja_api_is_refused_by_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(binding_module, "_bindings", {})
    placement = _golden("ninja")
    factories = placement.TasksHandlerFactories(
        tasks=None, drafts=None, channels=None, preferences=None, app=None, hooks=None
    )
    api = NinjaAPI(urls_namespace="seampact-second-bind")
    placement.bind_tasks(api, prefix="", handlers=factories)

    with pytest.raises(BindingError, match=r"bind_tasks\(\) was already called on this NinjaAPI"):
        placement.bind_tasks(api, prefix="", handlers=factories)


def test_an_auth_or_throttle_on_a_kind_whose_operation_declares_no_401_or_429_is_refused_at_boot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    access = {
        "public": AccessSettings(auth=[lambda request: None]),
        "identity": AccessSettings(throttle=[AuthRateThrottle("100/m")]),
    }

    with _served(monkeypatch, NinjaAPI(urls_namespace="seampact-access-roles"), access=access):
        problems = _golden("django").TasksBoundary.configuration_problems()

    assert (
        "bind_tasks(access=...) gives the access kind 'public' an auth=, and its operation 'health' declares no code "
        "for the role 'unauthenticated' nor a single code of status 401; declare one, or remove the auth=."
    ) in problems
    assert (
        "bind_tasks(access=...) gives the access kind 'identity' a throttle, and its operation 'getPreferences' "
        "declares no code for the role 'rateLimited' nor a single code of status 429; declare one, or remove the "
        "throttle."
    ) in problems


def test_ninjas_auth_refusal_on_a_contract_route_answers_the_operations_unauthenticated_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    refused_tokens: list[str] = []

    class Refusing(HttpBearer):
        def authenticate(self, request: object, token: str) -> None:
            refused_tokens.append(token)
            return None

    monkeypatch.setattr(_golden("django").TasksBoundary, "boot_check", False)
    access = {"identity": AccessSettings(auth=[Refusing()])}

    with _served(monkeypatch, NinjaAPI(urls_namespace="seampact-auth-role"), access=access):
        response = Client(raise_request_exception=False).get(
            "/v1/me/preferences", headers={"Authorization": "Bearer unknown"}
        )

    assert refused_tokens == ["unknown"]
    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert json.loads(response.content)["code"] == "api.unauthenticated"


_SERVICE_PACKAGE: Final = "tasks_service"
_SERVICE_TASK_PATH: Final = (
    "/internal/v1/channels/10000000-0000-4000-8000-000000000001/tasks/20000000-0000-4000-8000-000000000001"
)
_THROWN: Final = "the hook broke"


def _service(module: str) -> ModuleType:
    return importlib.import_module(f"{_GOLDEN_ROOT}.{_SERVICE_PACKAGE}.{module}")


class _Service:
    """The async api's hooks and handler: the decider and the authenticate hook admit, `get_task` answers what the
    test sets in `answer`. One method is `async def` and the others plain `def`, as the async views run both."""

    answer: Callable[[], object] = staticmethod(lambda: None)

    def __init__(self, request: HttpRequest) -> None:
        self.request = request

    def authenticate(self, request: object, /) -> object:
        schemas = _service("schemas")
        principal = schemas.ServicePrincipal(service=next(iter(schemas.Service)), user_id=uuid.uuid4())

        return authenticate_result.Authenticated(principal=principal)

    async def decide(self, request: object, /) -> object:
        return decision.Allowed()

    def get_task(self, request: object, /) -> object:
        return self.answer()


def _an_hour_from_now() -> str:
    return (datetime.now(UTC) + timedelta(hours=1)).isoformat().replace("+00:00", "Z")


def _a_task_reply() -> object:
    schemas = _service("schemas")
    task = schemas.Task(
        task_id=uuid.UUID(int=1), title="Served", state=schemas.TaskState.OPEN, version=1, created_at=datetime.now(UTC)
    )

    return _service("operations").GetTaskResponse200(task)


def _serve_the_async_api(monkeypatch: pytest.MonkeyPatch, answer: Callable[[], object]) -> tuple[int, bytes]:
    _Service.answer = staticmethod(answer)
    monkeypatch.setattr(_service("django").TasksServiceBoundary, "boot_check", False)
    api = NinjaAPI(urls_namespace="seampact-async-views")

    with _served(
        monkeypatch,
        api,
        package=_SERVICE_PACKAGE,
        handlers={"internal": _Service},
        authenticate={"service": _Service},
        deciders={"callerService": _Service},
    ):
        response = Client(raise_request_exception=False).get(
            _SERVICE_TASK_PATH, headers={"Authorization": "Bearer service", "X-Deadline": _an_hour_from_now()}
        )

    return response.status_code, response.content


def test_an_async_view_serves_a_plain_hook_a_coroutine_hook_and_a_plain_handler(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    status, content = _serve_the_async_api(monkeypatch, _a_task_reply)

    assert status == HTTPStatus.OK
    assert json.loads(content)["title"] == "Served"


def test_an_async_view_answers_the_code_of_a_declared_error_the_handler_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    def not_found() -> object:
        raise _service("operations").ApiNotFoundError()

    status, content = _serve_the_async_api(monkeypatch, not_found)

    assert status == HTTPStatus.NOT_FOUND
    assert json.loads(content)["code"] == "api.not_found"


def test_an_async_view_answers_a_contract_refusal_of_its_own_steps(monkeypatch: pytest.MonkeyPatch) -> None:
    class Denying(_Service):
        def authenticate(self, request: object, /) -> object:
            denial = ErrorCodeWithParams(code="api.unauthenticated")

            return authenticate_result.Denied(deny=denial)

    monkeypatch.setattr(_Service, "authenticate", Denying.authenticate)

    status, content = _serve_the_async_api(monkeypatch, pytest.fail)

    assert status == HTTPStatus.UNAUTHORIZED
    assert json.loads(content)["code"] == "api.unauthenticated"


def test_an_async_view_answers_the_apis_500_when_a_declared_error_cannot_be_written(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    base = _service("operations").TasksServiceContractError
    undeclared_error = type("Undeclared", (base,), {"CODE": "app.never_declared", "STATUS": HTTPStatus.CONFLICT})

    def undeclared() -> object:
        raise undeclared_error()

    status, content = _serve_the_async_api(monkeypatch, undeclared)

    assert status == HTTPStatus.INTERNAL_SERVER_ERROR
    assert json.loads(content)["code"] == "api.internal"
    assert "answering it failed" in caplog.text


def test_an_async_view_reached_without_the_boundarys_mark_fails_closed_with_the_apis_500(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = NinjaAPI(urls_namespace="seampact-async-unmarked")
    monkeypatch.setattr(_service("django").TasksServiceBoundary, "boot_check", False)

    with _served(monkeypatch, api, package=_SERVICE_PACKAGE, handlers={"internal": _Service}):
        placement = _service("ninja").PLACEMENT
        request = RequestFactory().get(_SERVICE_TASK_PATH)
        answered = asyncio.run(serve_operation_async(request, placement, "getTask"))

    assert answered.status_code == HTTPStatus.INTERNAL_SERVER_ERROR


def test_an_async_view_lets_an_unexpected_exception_go_on_to_the_apis_500(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken() -> object:
        raise RuntimeError(_THROWN)

    status, content = _serve_the_async_api(monkeypatch, broken)

    assert status == HTTPStatus.INTERNAL_SERVER_ERROR
    assert json.loads(content)["code"] == "api.internal"
    assert _THROWN.encode() not in content


class _HooksWhereOneThrows:
    """Admits, resolves and allows everything; the hook named in `throwing` raises instead."""

    throwing = ""

    def __init__(self, request: HttpRequest) -> None:
        self.request = request

    def authenticate(self, request: object, /) -> object:
        self._maybe_throw("authenticate")
        schemas = _golden("schemas")

        return authenticate_result.Authenticated(principal=schemas.UserPrincipal(user_id=uuid.uuid4()))

    def resolve_scope(self, request: object, /) -> object:
        self._maybe_throw("resolve_scope")
        source = request.source  # type: ignore[attr-defined]

        return scope_resolution.Resolved(resolved=ResolvedScope(scope=request.scope, id=source.id))  # type: ignore[attr-defined]

    def decide(self, request: object, /) -> object:
        self._maybe_throw("decide")

        return decision.Allowed()

    def _maybe_throw(self, hook: str) -> None:
        if self.throwing == hook:
            raise RuntimeError(_THROWN)


class _HandlerThatMustNotRun:
    def __getattr__(self, name: str) -> object:
        raise AssertionError(f"the handler method {name} was reached")


@pytest.mark.parametrize(
    ("hook", "operation", "method", "path"),
    [
        ("authenticate", "getChannel", "get", "/v1/channels/10000000-0000-4000-8000-000000000001"),
        ("resolve_scope", "getChannel", "get", "/v1/channels/10000000-0000-4000-8000-000000000001"),
        ("decide", "createTask", "post", "/v1/channels/10000000-0000-4000-8000-000000000001/tasks"),
    ],
)
def test_a_hook_that_throws_answers_the_apis_500_before_any_handler(
    monkeypatch: pytest.MonkeyPatch, hook: str, operation: str, method: str, path: str
) -> None:
    failures: list[UnexpectedFailure] = []

    class Listener:
        def __init__(self, request: HttpRequest) -> None:
            pass

        def on_unexpected_error(self, failure: UnexpectedFailure, /) -> None:
            failures.append(failure)

    monkeypatch.setattr(_HooksWhereOneThrows, "throwing", hook)
    monkeypatch.setattr(_golden("django").TasksBoundary, "boot_check", False)
    needs = hook_needs(_golden("contract").CONTRACT)
    resources = {"tasks": _HandlerThatMustNotRun, "channels": _HandlerThatMustNotRun}

    with _served(
        monkeypatch,
        NinjaAPI(urls_namespace="seampact-throwing-hooks"),
        handlers=resources,
        authenticate={name: _HooksWhereOneThrows for name in needs.identities},
        deciders={name: _HooksWhereOneThrows for name in needs.deciders},
        scope_resolvers={name: _HooksWhereOneThrows for name in needs.scopes},
        idempotency_store=lambda request: object(),
        on_unexpected_error=Listener,
    ):
        response = Client(raise_request_exception=False).generic(
            method.upper(),
            path,
            json.dumps({"title": "Write the guide"}) if method == "post" else "",
            content_type="application/json",
            headers={"Authorization": "Bearer user", "Idempotency-Key": "k-1"},
        )

    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert json.loads(response.content)["code"] == "api.internal"
    assert [failure.operation for failure in failures] == [operation]
    assert [str(failure.cause) for failure in failures] == [_THROWN]
