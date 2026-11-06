"""The Ninja placement at run time, on the reference contract's golden package: the boot check reads the handlers
and hooks from `bind_<api>()`, the route names reverse under the NinjaAPI's namespace, the contract views carry the
marks the boundary sets, Ninja still calls the wrapped `on_exception` and its auth refusal answers the operation's
code, Pydantic 1 is refused at boot, and the values of `bind_<api>()` the runtime cannot serve are refused by name."""

import importlib
import json
import sys
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from http import HTTPStatus
from importlib import metadata
from types import MappingProxyType, ModuleType
from typing import Final

import pytest
from django.core.cache import cache
from django.http import HttpRequest, HttpResponse
from django.test import Client, RequestFactory, override_settings
from django.urls import URLPattern, clear_url_caches, get_resolver, path, reverse
from ninja import NinjaAPI
from ninja.security import HttpBearer
from ninja.throttling import AnonRateThrottle, AuthRateThrottle

from seampact.codegen.runtime.framework_versions import framework_version_problems
from seampact.codegen.runtime.hook_check import hook_needs
from seampact.django.runtime.boot_check import boot_problems
from seampact.ninja.runtime import AccessSettings, BindingError, OperationSettings
from seampact.ninja.runtime import binding as binding_module
from seampact.ninja.runtime import exceptions as exceptions_module
from seampact.ninja.runtime.exceptions import recording_on_exception

_GOLDEN = "ninja_tests.golden.reference.tasks"
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
    **bind_values: object,
) -> Iterator[NinjaAPI]:
    """The golden api bound on `api`, served by a root URLconf of its own that includes `api.urls` at
    `include_prefix`; only the handler factories in `handlers` are given."""
    monkeypatch.setattr(binding_module, "_bindings", {})
    placement = _golden("ninja")
    resources = ("tasks", "drafts", "channels", "preferences", "app", "hooks")
    factories = placement.TasksHandlerFactories(**{resource: handlers.get(resource) for resource in resources})
    bind: Callable[..., None] = placement.bind_tasks
    bind(api, prefix="", handlers=factories, **bind_values)
    urlconf = ModuleType(_URLCONF)
    urlconf.urlpatterns = [path(include_prefix, api.urls)]  # type: ignore[attr-defined]
    sys.modules[_URLCONF] = urlconf
    clear_url_caches()

    with override_settings(
        ROOT_URLCONF=_URLCONF, MIDDLEWARE=[f"{_GOLDEN}.django.TasksBoundary"], ALLOWED_HOSTS=["testserver"]
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
        "operation 'health': no URL pattern serves /v1/health; include the NinjaAPI's urls at a prefix that, followed "
        "by bind_tasks(prefix=...), equals the entry's mount."
    ) in problems


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
