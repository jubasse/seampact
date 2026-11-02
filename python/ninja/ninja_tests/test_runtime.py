"""The Ninja placement at run time, on the reference contract's golden package: the boot check reads the handlers
and hooks from `bind_<api>()`, the route names reverse under the NinjaAPI's namespace, the contract views carry the
marks the boundary sets, Ninja still calls the wrapped `on_exception`, and Pydantic 1 is refused at boot."""

import importlib
import json
import sys
from collections.abc import Callable, Iterator
from http import HTTPStatus
from importlib import metadata
from types import ModuleType

import pytest
from django.http import HttpRequest, HttpResponse
from django.test import RequestFactory, override_settings
from django.urls import URLPattern, clear_url_caches, get_resolver, path, reverse
from ninja import NinjaAPI
from ninja.security import HttpBearer

from seampact.codegen.runtime.framework_versions import framework_version_problems
from seampact.ninja.runtime import binding as binding_module
from seampact.ninja.runtime import exceptions as exceptions_module
from seampact.ninja.runtime.exceptions import recording_on_exception

_GOLDEN = "ninja_tests.golden.reference.tasks"
_URLCONF = "ninja_tests.seampact_bound_urls"


def _golden(module: str) -> ModuleType:
    return importlib.import_module(f"{_GOLDEN}.{module}")


@pytest.fixture
def bound_api(monkeypatch: pytest.MonkeyPatch) -> Iterator[NinjaAPI]:
    """The golden api bound on a fresh NinjaAPI, served by a root URLconf of its own; no handler or hook given."""
    monkeypatch.setattr(binding_module, "_bindings", {})
    # Ninja 1.5 refuses a second NinjaAPI of one urls_namespace in a process; each test builds its own.
    monkeypatch.setenv("NINJA_SKIP_REGISTRY", "1")
    placement = _golden("ninja")
    api = NinjaAPI(urls_namespace="seampact-runtime")
    factories = placement.TasksHandlerFactories(
        tasks=None, drafts=None, channels=None, preferences=None, app=None, hooks=None
    )
    bind: Callable[..., None] = placement.bind_tasks
    bind(api, prefix="", handlers=factories)
    urlconf = ModuleType(_URLCONF)
    urlconf.urlpatterns = [path("", api.urls)]  # type: ignore[attr-defined]
    sys.modules[_URLCONF] = urlconf
    clear_url_caches()

    with override_settings(ROOT_URLCONF=_URLCONF, MIDDLEWARE=[f"{_GOLDEN}.django.TasksBoundary"]):
        yield api

    clear_url_caches()
    del sys.modules[_URLCONF]


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
