"""The Django boundary and the DRF steps at run time, through Django's test `Client` against the reference contract's
generated package: step 1's refusals, steps 2 to 8, the handler's reply, the exception map, the outgoing check, the
boot check, the system check and `seampact_check`. The package is generated without the features a later release
serves (idempotency, restricted fields, cache headers, the concurrency check, throttle buckets)."""

import asyncio
import gzip
import importlib
import json
import sys
from collections.abc import Callable, Iterator
from http import HTTPStatus
from io import StringIO
from pathlib import Path
from types import ModuleType
from typing import Final

import pytest
from django.core.checks import run_checks
from django.core.exceptions import ImproperlyConfigured, PermissionDenied
from django.core.management import call_command
from django.core.management.base import CommandError
from django.http import Http404, HttpRequest, HttpResponse, HttpResponseBase
from django.test import AsyncClient, Client, override_settings
from django.urls import include, path, re_path

from seampact.codegen.runtime.ir_view import ir_map, ir_maps, ir_string
from seampact.hooks import (
    AuthenticateRequest,
    ErrorCodeWithParams,
    RequirementRequest,
    ResolvedScope,
    ResolveScopeRequest,
    UnexpectedFailure,
    authenticate_result,
    decision,
    scope_id_source,
    scope_resolution,
)
from seampact.ir.config.json_value import JsonValue

from .test_drf_generator import contract, generated_files, imported_package, reference_ir, write_package

_PACKAGE: Final = "seampact_drf_boundary_tasks"
_ROOT_URLCONF: Final = "seampact_drf_boundary_root"
_TOKEN: Final = "good-token"
_USER_ID: Final = "8d0f3c3e-6a52-4c0e-9b8e-3f1f2f6f1a11"
_CHANNEL_ID: Final = "0a2c3b7e-1d4f-4e8a-9c1b-2e3d4f5a6b7c"
_LATER_FEATURES: Final = ("fieldRights", "cache", "concurrency")

# What the hooks and handlers of one test answer; each test sets what it needs.
answers: dict[str, Callable[[object], object]] = {}
failures: list[UnexpectedFailure] = []


class _Hooks:
    def authenticate(self, request: AuthenticateRequest, /) -> object:
        credentials = request.credentials

        if isinstance(credentials, _module("operations").UserCredentials) and credentials.bearer == _TOKEN:
            principal = _module("schemas").UserPrincipal(user_id=_uuid(_USER_ID))
            return authenticate_result.Authenticated(principal=principal)

        return authenticate_result.Denied(deny=_denial("api.unauthenticated"))

    def decide(self, request: RequirementRequest, /) -> object:
        answer = answers.get("decide")

        return decision.Allowed() if answer is None else answer(request)

    def resolve_scope(self, request: ResolveScopeRequest, /) -> object:
        answer = answers.get("resolve_scope")

        if answer is not None:
            return answer(request)

        source = request.source
        assert isinstance(source, scope_id_source.Declared)

        return scope_resolution.Resolved(resolved=ResolvedScope(scope=request.scope, id=source.id))


def _forwarded(name: str) -> Callable[[object, object], object]:
    def handle(self: object, request: object) -> object:
        return answers[name](request)

    return handle


class _Handlers:
    """Every handler method of the api, added by the `package` fixture; each answers what the test set under its
    name."""


class _Listener:
    def on_unexpected_error(self, failure: UnexpectedFailure, /) -> None:
        failures.append(failure)


def hooks(request: HttpRequest) -> _Hooks:
    return _Hooks()


def handlers(request: HttpRequest) -> _Handlers:
    return _Handlers()


def listener(request: HttpRequest) -> _Listener:
    return _Listener()


class RaisingMiddleware:
    """An app middleware inside the boundary that raises what the `X-Raise` header names."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponseBase]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponseBase:
        raised = {"404": Http404, "403": PermissionDenied, "500": ValueError}.get(request.headers.get("X-Raise", ""))

        if raised is not None:
            raise raised("raised by the app")

        if request.headers.get("X-Answer") == "foreign":
            return HttpResponse(b"{}", status=200, content_type="application/json")

        return self.get_response(request)


@pytest.fixture(scope="module")
def package(repository_root: Path, tmp_path_factory: pytest.TempPathFactory) -> ModuleType:
    directory = tmp_path_factory.mktemp("boundary") / _PACKAGE
    write_package(generated_files(contract(_served_ir(repository_root))), directory)
    imported = imported_package(directory, _PACKAGE)
    operations = importlib.import_module(f"{_PACKAGE}.operations")

    for protocol in vars(operations).values():
        if isinstance(protocol, type) and protocol.__name__.endswith("Endpoints"):
            for method in protocol.__protocol_attrs__:  # type: ignore[attr-defined]
                setattr(_Handlers, method, _forwarded(method))

    root = ModuleType(_ROOT_URLCONF)
    root.__dict__["urlpatterns"] = [path("", include(f"{_PACKAGE}.urls"))]
    sys.modules[_ROOT_URLCONF] = root

    return imported


@pytest.fixture(autouse=True)
def served(package: ModuleType) -> Iterator[None]:
    answers.clear()
    failures.clear()

    with override_settings(
        ROOT_URLCONF=_ROOT_URLCONF,
        MIDDLEWARE=_middleware(),
        SEAMPACT={"tasks": _settings()},
        ALLOWED_HOSTS=["testserver"],
    ):
        yield


def test_a_public_operation_answers_the_handlers_result_and_head_drops_the_body() -> None:
    answers["health"] = lambda _: _module("operations").HealthResponse200(body=_module("schemas").Health(status="ok"))

    response = Client().get("/v1/health")
    head = Client().head("/v1/health")

    assert response.status_code == HTTPStatus.OK
    assert json.loads(response.content) == {"status": "ok"}
    assert "Vary" not in response and "Allow" not in response
    assert head.status_code == HTTPStatus.OK and head.content == b""


def test_a_path_or_method_the_api_does_not_serve_is_the_apis_404_before_routing() -> None:
    unknown = Client().get("/v1/nothing-here")
    other_method = Client().delete("/v1/health")
    dot_segment = Client().get("/v1/channels/%2e%2e")

    for response in (unknown, other_method, dot_segment):
        assert response.status_code == HTTPStatus.NOT_FOUND
        assert _code(response) == "api.not_found"


def test_a_request_outside_the_apis_base_paths_is_left_to_the_app() -> None:
    assert Client().get("/elsewhere").status_code == HTTPStatus.NOT_FOUND
    assert Client().get("/elsewhere")["Content-Type"].startswith("text/html")


def test_steps_two_to_five_admit_the_caller_and_resolve_its_scope() -> None:
    seen: list[object] = []

    def get_channel(request: object) -> object:
        seen.append(request)
        channel = _module("schemas").Channel(channel_id=_uuid(_CHANNEL_ID), name="general")
        return _module("operations").GetChannelResponse200(body=channel)

    answers["get_channel"] = get_channel

    response = Client().get(f"/v1/channels/{_CHANNEL_ID}", headers=_bearer())

    assert response.status_code == HTTPStatus.OK, response.content
    assert json.loads(response.content) == {"channelId": _CHANNEL_ID, "name": "general"}
    received = seen[0]
    assert str(received.principal.user_id) == _USER_ID  # type: ignore[attr-defined]
    assert received.scopes.channel.id == _CHANNEL_ID  # type: ignore[attr-defined]


def test_a_missing_or_denied_credential_is_unauthenticated() -> None:
    assert _code(Client().get(f"/v1/channels/{_CHANNEL_ID}")) == "api.unauthenticated"
    assert _code(Client().get(f"/v1/channels/{_CHANNEL_ID}", headers={"Authorization": "Bearer bad"})) == (
        "api.unauthenticated"
    )


def test_a_scope_id_of_the_wrong_format_is_refused_before_its_resolver() -> None:
    answers["resolve_scope"] = lambda _: pytest.fail("the resolver ran")

    response = Client().get("/v1/channels/not-a-uuid", headers=_bearer())

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert _issues(response) == [{"pointer": "/channelId", "rule": "format"}]


def test_a_scope_resolvers_denial_answers_its_declared_code() -> None:
    answers["resolve_scope"] = lambda _: scope_resolution.Denied(deny=_denial("api.not_found"))

    response = Client().get(f"/v1/channels/{_CHANNEL_ID}", headers=_bearer())

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert _code(response) == "api.not_found"


def test_the_body_is_validated_by_type_then_by_the_serializer_and_reaches_the_handler_as_dataclasses() -> None:
    seen: list[object] = []

    def create_task(request: object) -> object:
        seen.append(request)
        return _module("operations").CreateTaskResponse201(body=_task())

    answers["create_task"] = create_task
    url = f"/v1/channels/{_CHANNEL_ID}/tasks"
    created = _post(url, {"title": "Write the guide", "effort": 3.0})
    wrong_type = _post(url, {"title": 5, "effort": "3"})
    too_long = _post(url, {"title": "x" * 201, "unknown": True})

    assert created.status_code == HTTPStatus.CREATED
    body = seen[0].input.body  # type: ignore[attr-defined]
    assert (body.title, body.effort) == ("Write the guide", 3)
    assert _issues(wrong_type) == [
        {"pointer": "/title", "rule": "type"},
        {"pointer": "/effort", "rule": "type"},
    ]
    assert _issues(too_long) == [
        {"pointer": "/unknown", "rule": "unknownKeys"},
        {"pointer": "/title", "rule": "maxLength"},
    ]


def test_step_one_refuses_an_oversized_compressed_or_malformed_body_and_another_media_type() -> None:
    url = f"/v1/channels/{_CHANNEL_ID}/tasks"
    headers = {**_bearer(), "Idempotency-Key": "k-1"}
    bomb = gzip.compress(b'{"title": "' + b"x" * 2_000_000 + b'"}')

    oversized = Client().post(
        url, bomb, content_type="application/json", headers={**headers, "Content-Encoding": "gzip"}
    )
    malformed = Client().post(url, b"{", content_type="application/json", headers=headers)
    other_media = Client().post(url, b"title=x", content_type="text/plain", headers=headers)

    assert _code(oversized) == "api.payload_too_large"
    assert _code(malformed) == "api.schema_invalid"
    assert _code(other_media) == "api.unsupported_media_type"


def test_a_contract_exception_raised_by_the_handler_is_rendered() -> None:
    def get_channel(request: object) -> object:
        raise _module("operations").ApiNotFoundError()

    answers["get_channel"] = get_channel

    response = Client().get(f"/v1/channels/{_CHANNEL_ID}", headers=_bearer())

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert _code(response) == "api.not_found"


def test_any_other_exception_is_the_apis_500_and_the_listener_hears_of_it() -> None:
    def get_channel(request: object) -> object:
        raise RuntimeError("a bug")

    answers["get_channel"] = get_channel

    response = Client().get(f"/v1/channels/{_CHANNEL_ID}", headers=_bearer())

    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert _code(response) == "api.internal"
    assert [failure.operation for failure in failures] == ["getChannel"]


def test_an_exception_raised_by_an_app_middleware_answers_by_its_role() -> None:
    url = f"/v1/channels/{_CHANNEL_ID}"

    assert _code(Client().get(url, headers={"X-Raise": "404"})) == "api.not_found"
    # getChannel declares no forbidden code nor a single 403 code: ADR 0023's rule answers the api's 500.
    assert _code(Client().get(url, headers={"X-Raise": "403"})) == "api.internal"
    assert Client(raise_request_exception=False).get(url, headers={"X-Raise": "500"}).status_code == 500
    assert [failure.operation for failure in failures] == ["getChannel", "getChannel"]


def test_a_reply_the_boundary_did_not_write_is_replaced_by_the_apis_500() -> None:
    response = Client().get(f"/v1/channels/{_CHANNEL_ID}", headers={"X-Answer": "foreign"})

    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert "outgoing check" in failures[0].reason


def test_an_operation_with_a_feature_a_later_release_serves_fails_closed_by_name() -> None:
    response = Client().get("/v1/channels", headers=_bearer())

    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert "paging" in failures[0].reason


def test_the_boundary_runs_async_when_every_middleware_inside_it_is_async_capable() -> None:
    answers["health"] = lambda _: _module("operations").HealthResponse200(body=_module("schemas").Health(status="ok"))

    with override_settings(MIDDLEWARE=[f"{_PACKAGE}.django.TasksBoundary"]):
        response = asyncio.run(AsyncClient().get("/v1/health"))

    assert response.status_code == HTTPStatus.OK
    assert json.loads(response.content) == {"status": "ok"}


def test_drf_marks_the_contract_views_login_required_false() -> None:
    view = _module("urls").urlpatterns[0].callback

    assert view.login_required is False


def test_the_boot_check_refuses_to_serve_and_lists_every_problem() -> None:
    root = ModuleType("seampact_drf_boundary_catch_all")
    root.__dict__["urlpatterns"] = [
        re_path(r"^v1/channels/.*$", lambda request: HttpResponse()),
        path("", include(f"{_PACKAGE}.urls")),
    ]
    sys.modules[root.__name__] = root
    broken = {**_settings(), "unknown": True}
    del broken["handlers"]["channels"]  # type: ignore[attr-defined]

    with (
        override_settings(ROOT_URLCONF=root.__name__, SEAMPACT={"tasks": broken}),
        pytest.raises(ImproperlyConfigured) as refused,
    ):
        Client().get("/v1/health")

    message = str(refused.value)
    assert "unknown key 'unknown'" in message
    assert "no entry for 'channels'" in message
    assert "operation 'getChannel'" in message and "not its generated view" in message


def test_the_system_check_warns_and_seampact_check_fails_on_a_problem() -> None:
    with override_settings(MIDDLEWARE=["django.middleware.common.CommonMiddleware", *_middleware()]):
        warnings = [message for message in run_checks() if message.id == "seampact.tasks"]

        with pytest.raises(CommandError):
            call_command("seampact_check", stderr=StringIO())

    passing = StringIO()
    call_command("seampact_check", stdout=passing)

    assert any("not first in MIDDLEWARE" in warning.msg for warning in warnings)
    assert "passes" in passing.getvalue()


def _served_ir(repository_root: Path) -> dict[str, JsonValue]:
    ir = reference_ir(repository_root, "tasks")

    for operation in ir["operations"]:  # type: ignore[union-attr]
        assert isinstance(operation, dict)

        for feature in _LATER_FEATURES:
            operation.pop(feature, None)

        operation["fieldRights"] = []
        operation["requires"] = [item for item in operation["requires"] if "bucket" not in item]  # type: ignore[operator, union-attr]

        if "idempotency" in operation:
            operation["idempotency"] = {
                "kind": "exempt",
                "reason": "Served by a later release.",
                "origin": operation["origin"],
            }

    return ir


def _settings() -> dict[str, object]:
    contract_view = importlib.import_module(f"{_PACKAGE}.contract").CONTRACT
    operations = [contract_view.operation(operation_id) for operation_id in contract_view.operation_ids()]
    identities = {ir_string(ir_map(item, "access"), "identity") for item in operations} - {None, "stripe"}
    deciders = {
        ir_string(item, ir_string(item, "kind") or "") for item in operations for item in ir_maps(item, "requires")
    }
    scopes = {ir_string(item, "scope") for item in operations for item in ir_maps(item, "scopes")}
    resources = importlib.import_module(f"{_PACKAGE}.django").TasksBoundary.handler_resources

    return {
        "handlers": {resource: f"{__name__}.handlers" for resource in resources},
        "authenticate": {str(name): f"{__name__}.hooks" for name in identities},
        "deciders": {str(name): f"{__name__}.hooks" for name in deciders},
        "scope_resolvers": {str(name): f"{__name__}.hooks" for name in scopes},
        "on_unexpected_error": f"{__name__}.listener",
    }


def _middleware() -> list[str]:
    return [
        f"{_PACKAGE}.django.TasksBoundary",
        "django.middleware.common.CommonMiddleware",
        f"{__name__}.RaisingMiddleware",
    ]


def _module(name: str) -> ModuleType:
    return importlib.import_module(f"{_PACKAGE}.{name}")


def _uuid(text: str) -> object:
    import uuid

    return uuid.UUID(text)


def _task() -> object:
    from datetime import UTC, datetime

    state = _module("schemas").TaskState
    return _module("schemas").Task(
        task_id=_uuid(_USER_ID),
        title="Write the guide",
        state=next(iter(state)),
        version=1,
        created_at=datetime.now(UTC),
    )


def _denial(code: str) -> ErrorCodeWithParams:
    return ErrorCodeWithParams(code=code)


def _bearer() -> dict[str, str]:
    return {"Authorization": f"Bearer {_TOKEN}"}


def _post(url: str, body: object) -> HttpResponseBase:
    return Client().post(
        url, json.dumps(body), content_type="application/json", headers={**_bearer(), "Idempotency-Key": "k-1"}
    )


def _code(response: HttpResponseBase) -> object:
    return json.loads(response.content).get("code")  # type: ignore[attr-defined]


def _issues(response: HttpResponseBase) -> object:
    body = json.loads(response.content)  # type: ignore[attr-defined]
    assert "issues" in body, body
    return body["issues"]
