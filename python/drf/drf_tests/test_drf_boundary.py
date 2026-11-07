"""The Django boundary and the DRF steps at run time, through Django's test `Client` against the reference contract's
generated package: step 1's refusals, steps 2 to 8, the handler's reply, the exception map, the outgoing check, the
boot check, the system check and `seampact_check`, and the version a header carries. `archiveTask` reads its version
from `If-Match` here, as a contract with a header version gives it."""

import asyncio
import dataclasses
import gzip
import importlib
import json
import logging
import sys
from collections.abc import Callable, Iterator
from http import HTTPStatus
from io import StringIO
from pathlib import Path
from types import ModuleType
from typing import Final

import pytest
from django.conf import settings
from django.conf.urls.i18n import i18n_patterns
from django.contrib.auth.models import AnonymousUser, User
from django.core.checks import run_checks
from django.core.exceptions import ImproperlyConfigured, PermissionDenied
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.http import Http404, HttpRequest, HttpResponse, HttpResponseBase, StreamingHttpResponse
from django.test import AsyncClient, Client, override_settings
from django.urls import include, path, re_path
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.exceptions import PermissionDenied as DrfPermissionDenied
from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.throttling import BaseThrottle
from rest_framework.views import APIView

from seampact.codegen.runtime.failures import BoundaryFailureError
from seampact.codegen.runtime.framework_routes import FrameworkRouteRule
from seampact.codegen.runtime.framework_versions import AcceptedFramework, VersionUnit
from seampact.codegen.runtime.hook_check import hook_needs
from seampact.codegen.runtime.ir_view import ir_map, ir_string
from seampact.codegen.runtime.requirement_params import requirement_params
from seampact.django.runtime.boot_check import boot_problems
from seampact.drf.runtime import admission
from seampact.hooks import (
    AuthenticateRequest,
    ErrorCodeWithParams,
    IdempotencyClaim,
    RequirementKind,
    RequirementRequest,
    ResolvedScope,
    ResolveScopeRequest,
    StoredResponse,
    UnexpectedFailure,
    authenticate_result,
    decision,
    idempotency_begin,
    purpose,
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
_ARCHIVE_TASK: Final = "archiveTask"
_CREATE_TASK: Final = "createTask"
_GET_TASK: Final = "getTask"
_DEADLINE_EXCEEDED: Final = "api.deadline_exceeded"
_PRECONDITION_CODES: Final = (
    ("api.precondition_failed", 412, "preconditionFailed"),
    ("api.precondition_required", 428, "preconditionRequired"),
)
_SECRET: Final = "secret-token-123"
_PUBLIC_ORIGIN: Final = "https://api.example.com"
_BEARER: Final = {"Authorization": f"Bearer {_TOKEN}"}
# A Django CSRF secret: 32 letters or digits.
_CSRF_SECRET: Final = "csrfsecret0123456789abcdefghijkl"
_THROTTLE_WAIT_SECONDS: Final = 2.5
_DRF_PERMISSIONS: Final = "rest_framework.permissions"

# What the hooks and handlers of one test answer; each test sets what it needs.
answers: dict[str, Callable[[object], object]] = {}
failures: list[UnexpectedFailure] = []
idempotency_records: dict[str, tuple[str, StoredResponse | None]] = {}
hook_factory_users: list[object] = []


class _MemoryStore:
    """An idempotency store in memory, emptied before each test."""

    def begin(self, claim: IdempotencyClaim, /) -> object:
        known = idempotency_records.get(claim.key)

        if known is None:
            idempotency_records[claim.key] = (claim.fingerprint, None)
            return idempotency_begin.Started()

        fingerprint, stored = known

        if fingerprint != claim.fingerprint:
            return idempotency_begin.Mismatch()

        return idempotency_begin.Running() if stored is None else idempotency_begin.Replay(response=stored)

    def complete(self, key: str, response: StoredResponse, /) -> None:
        idempotency_records[key] = (idempotency_records[key][0], response)

    def abandon(self, key: str, /) -> None:
        idempotency_records.pop(key, None)


class _DatabaseStore(_MemoryStore):
    """A store that reaches the database on every write, as an ORM-backed store does: Django refuses that call on
    the event loop."""

    def complete(self, key: str, response: StoredResponse, /) -> None:
        _touch_the_database()
        super().complete(key, response)

    def abandon(self, key: str, /) -> None:
        _touch_the_database()
        super().abandon(key)


def _touch_the_database() -> None:
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")


class _Hooks:
    def authenticate(self, request: AuthenticateRequest, /) -> object:
        answer = answers.get("authenticate")

        if answer is not None:
            return answer(request)

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


def store(request: HttpRequest) -> _MemoryStore:
    return _MemoryStore()


def database_store(request: HttpRequest) -> _DatabaseStore:
    return _DatabaseStore()


class TokenUser:
    is_authenticated = True


class BearerAuthentication(BaseAuthentication):
    """Authenticates the test token, and leaves any other request to the next class."""

    def authenticate(self, request: Request) -> tuple[TokenUser, str] | None:
        return (TokenUser(), _TOKEN) if request.headers.get("Authorization") == f"Bearer {_TOKEN}" else None

    def authenticate_header(self, request: Request) -> str:
        return "Bearer"


class RefusingAuthentication(BaseAuthentication):
    def authenticate(self, request: Request) -> None:
        raise AuthenticationFailed("the token is revoked")


class ForbiddingAuthentication(BaseAuthentication):
    def authenticate(self, request: Request) -> None:
        raise DrfPermissionDenied("the account is locked")


class DenyingPermission(BasePermission):
    def has_permission(self, request: Request, view: APIView) -> bool:
        return False


class ExhaustedThrottle(BaseThrottle):
    def allow_request(self, request: Request, view: APIView) -> bool:
        return False

    def wait(self) -> float:
        return _THROTTLE_WAIT_SECONDS


class CorsMiddleware:
    """The app's CORS layer inside the boundary, as django-cors-headers answers a preflight."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponseBase]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponseBase:
        if request.method == "OPTIONS" and "Access-Control-Request-Method" in request.headers:
            answered = HttpResponse(status=HTTPStatus.OK)
            answered["Access-Control-Allow-Origin"] = request.headers.get("Origin", "")
            return answered

        return self.get_response(request)


class _MountedAsyncClient(AsyncClient):
    """An ASGI server mounting the app under `/svc`: Django's test client sets no `root_path`, and the stubs leave out
    the private method that builds its scope."""

    def _base_scope(self, **request: object) -> dict[str, object]:
        return {**super()._base_scope(**request), "root_path": "/svc"}  # type: ignore[misc]


def user_reading_hooks(request: HttpRequest) -> _Hooks:
    """The hooks, after recording the user DRF's authentication set on the Django request."""
    hook_factory_users.append(request.user)
    return _Hooks()


class RaisingMiddleware:
    """An app middleware inside the boundary that raises what the `X-Raise` header names."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponseBase]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponseBase | None:
        raised = {"404": Http404, "403": PermissionDenied, "500": ValueError}.get(request.headers.get("X-Raise", ""))

        if raised is not None:
            raise raised(f"raised by the app with {_SECRET}")

        answer = request.headers.get("X-Answer")

        if answer == "foreign":
            return HttpResponse(b"{}", status=200, content_type="application/json")

        if answer == "html":
            return HttpResponse(b"<p>app page</p>", status=200, content_type="text/html")

        if answer == "stream":
            return StreamingHttpResponse(_failing_stream(), status=200, content_type="application/json")

        if answer == "none":
            return None

        if answer == "raise-after-view":
            self.get_response(request)
            raise ValueError("raised by the app after the view")

        if answer == "stream-after-view":
            self.get_response(request)
            return StreamingHttpResponse(iter([b'{"status": "ok"}']), status=200, content_type="application/json")

        return self.get_response(request)


def _failing_stream() -> Iterator[bytes]:
    yield b'{"status": '
    raise ValueError(f"the stream broke with {_SECRET}")


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
    idempotency_records.clear()
    hook_factory_users.clear()

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


def test_an_undeclared_query_key_is_refused_when_the_operation_declares_no_query() -> None:
    answers["health"] = lambda _: pytest.fail("the handler ran")

    response = Client().get("/v1/health?x=1")

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert _code(response) == "api.schema_invalid"
    assert _issues(response) == [{"pointer": "/x", "rule": "unknownKeys"}]


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


@pytest.mark.parametrize("hook", ["authenticate", "resolve_scope", "decide"])
def test_a_hook_that_throws_answers_the_apis_500_and_never_lets_the_request_through(hook: str) -> None:
    def explode(request: object) -> object:
        raise RuntimeError("the hook broke")

    answers[hook] = explode
    answers["create_task"] = lambda _: pytest.fail("the handler ran")

    response = Client().post(
        f"/v1/channels/{_CHANNEL_ID}/tasks",
        json.dumps({"title": "Write the guide"}),
        content_type="application/json",
        headers={**_bearer(), "Idempotency-Key": "k-1"},
    )

    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert _code(response) == "api.internal"
    assert [failure.operation for failure in failures] == ["createTask"]


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


def test_an_operation_the_contract_relays_is_served(monkeypatch: pytest.MonkeyPatch) -> None:
    contract_view = _module("contract").CONTRACT
    monkeypatch.setitem(contract_view.operation("health"), "relays", {"api": "tasks", "id": "health"})
    answers["health"] = lambda _: _module("operations").HealthResponse200(body=_module("schemas").Health(status="ok"))

    response = Client().get("/v1/health")

    assert (response.status_code, json.loads(response.content)) == (HTTPStatus.OK, {"status": "ok"})
    assert failures == []


def test_page_links_start_with_the_public_origin_under_absolute_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    _write_absolute_urls(monkeypatch)
    answers["list_tasks"] = lambda _: _module("operations").ListTasksResponse200(
        body=_module("operations").ListTasksPage(items=[], next_cursor="c-2")
    )
    absolute = {**_settings(), "public_origin": _PUBLIC_ORIGIN}

    with override_settings(SEAMPACT={"tasks": absolute}):
        response = Client().get(f"/v1/channels/{_CHANNEL_ID}/tasks?limit=5", headers=_bearer())

    assert response.status_code == HTTPStatus.OK, response.content
    assert response["Link"].startswith(f"<{_PUBLIC_ORIGIN}/v1/channels/{_CHANNEL_ID}/tasks?"), response["Link"]


def test_absolute_page_links_keep_the_script_name_under_wsgi_and_asgi(monkeypatch: pytest.MonkeyPatch) -> None:
    _write_absolute_urls(monkeypatch)
    answers["list_tasks"] = lambda _: _module("operations").ListTasksResponse200(
        body=_module("operations").ListTasksPage(items=[], next_cursor="c-2")
    )
    page = f"/v1/channels/{_CHANNEL_ID}/tasks"

    async def under_asgi() -> HttpResponseBase:
        return await _MountedAsyncClient().get(f"/svc{page}", headers=_bearer())

    with override_settings(SEAMPACT={"tasks": {**_settings(), "public_origin": _PUBLIC_ORIGIN}}):
        wsgi = Client().get(page, headers=_bearer(), SCRIPT_NAME="/svc")
        asgi = asyncio.run(under_asgi())

    for response in (wsgi, asgi):
        assert response.status_code == HTTPStatus.OK, _code(response)
        assert response["Link"].startswith(f"<{_PUBLIC_ORIGIN}/svc{page}?"), response["Link"]


@pytest.mark.parametrize(
    ("public_origin", "named"),
    [
        (None, "is not set: set it to the origin clients call"),
        ("api.example.com", "has no http or https scheme"),
    ],
)
def test_a_missing_or_malformed_public_origin_under_absolute_urls_is_refused_at_boot(
    monkeypatch: pytest.MonkeyPatch, public_origin: str | None, named: str
) -> None:
    _write_absolute_urls(monkeypatch)
    own = {**_settings(), "public_origin": public_origin}

    with override_settings(SEAMPACT={"tasks": own}), pytest.raises(ImproperlyConfigured) as refused:
        Client().get("/v1/health")

    assert "settings.SEAMPACT['tasks']['public_origin']" in str(refused.value)
    assert named in str(refused.value)


def test_a_public_origin_under_relative_urls_is_refused_at_boot() -> None:
    own = {**_settings(), "public_origin": _PUBLIC_ORIGIN}

    with override_settings(SEAMPACT={"tasks": own}), pytest.raises(ImproperlyConfigured, match="writes relative URLs"):
        Client().get("/v1/health")


def test_a_query_list_reaches_the_handler_as_typed_items_in_its_repeat_and_comma_forms() -> None:
    seen: list[object] = []

    def keep_query(request: object) -> object:
        seen.append(request.input.query)  # type: ignore[attr-defined]

        return _module("operations").ListTasksResponse200(body=_module("operations").ListTasksPage(items=[]))

    answers["list_tasks"] = keep_query

    repeated = Client().get(f"/v1/channels/{_CHANNEL_ID}/tasks?state=open&state=done", headers=_bearer())
    comma = Client().get(f"/v1/channels/{_CHANNEL_ID}/tasks?sort=createdAt,-createdAt", headers=_bearer())

    assert repeated.status_code == HTTPStatus.OK, repeated.content
    assert comma.status_code == HTTPStatus.OK, comma.content
    task_state = _module("schemas").TaskState
    assert [query.state for query in seen[:1]] == [[task_state.OPEN, task_state.DONE]]  # type: ignore[attr-defined]
    assert [query.sort for query in seen[1:]] == [["createdAt", "-createdAt"]]  # type: ignore[attr-defined]


def test_a_page_projection_that_is_not_a_list_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    async def projected_to_a_mapping(*_: object) -> object:
        return {"items": []}

    monkeypatch.setattr(admission, "visible_output", projected_to_a_mapping)
    answers["list_tasks"] = lambda _: _module("operations").ListTasksResponse200(
        body=_module("operations").ListTasksPage(items=[])
    )

    response = Client().get(f"/v1/channels/{_CHANNEL_ID}/tasks", headers=_bearer())

    assert (response.status_code, _code(response)) == (HTTPStatus.INTERNAL_SERVER_ERROR, "api.internal")
    assert "not a list" in failures[0].reason


def test_the_decider_gets_the_use_site_params_as_the_rights_generated_params_class() -> None:
    asked: list[RequirementRequest] = []

    def denied_after_roles(request: object) -> object:
        assert isinstance(request, RequirementRequest)
        asked.append(request)

        return decision.Denied(deny=_denial("api.forbidden")) if request.name == "roles" else decision.Allowed()

    answers["create_task"] = lambda _: pytest.fail("the handler ran")
    answers["decide"] = denied_after_roles

    response = Client().post(
        f"/v1/channels/{_CHANNEL_ID}/tasks",
        json.dumps({"title": "Write the guide"}),
        content_type="application/json",
        headers={**_bearer(), "Idempotency-Key": "k-1"},
    )

    assert _code(response) == "api.forbidden", response.content
    roles = next(request for request in asked if request.name == "roles")
    schemas = _module("schemas")
    assert roles.params == schemas.RolesParams(allowed=[schemas.Role.OWNER, schemas.Role.EDITOR])


@pytest.mark.parametrize("allowed", [[], "owner", ["admin"]])
def test_use_site_params_the_dataclass_does_not_hold_fail_the_boundary(allowed: object) -> None:
    contract = _module("contract").CONTRACT

    with pytest.raises(BoundaryFailureError, match="roles"):
        requirement_params(contract, RequirementKind.RIGHT, "roles", {"params": {"allowed": allowed}})


def test_the_input_field_rights_are_applied_before_the_deadline() -> None:
    answers["create_task"] = lambda _: pytest.fail("the handler ran")
    answers["decide"] = lambda request: (
        decision.Denied(deny=_denial("api.forbidden"))
        if isinstance(request.purpose, purpose.Field)  # type: ignore[attr-defined]
        else decision.Allowed()
    )
    passed = {"X-Deadline": "2020-01-01T00:00:00Z"}

    response = Client().post(
        f"/v1/channels/{_CHANNEL_ID}/tasks",
        json.dumps({"title": "Write the guide", "effort": 3.0}),
        content_type="application/json",
        headers={**_bearer(), "Idempotency-Key": "k-1", **passed},
    )

    assert _code(response) == "api.forbidden", response.content
    without_the_field = Client().post(
        f"/v1/channels/{_CHANNEL_ID}/tasks",
        json.dumps({"title": "Write the guide"}),
        content_type="application/json",
        headers={**_bearer(), "Idempotency-Key": "k-2", **passed},
    )
    assert _code(without_the_field) == "api.deadline_exceeded", without_the_field.content


def test_an_orm_backed_store_settles_the_record_under_asgi() -> None:
    created: list[object] = []

    def create_task(request: object) -> object:
        created.append(request)
        return _module("operations").CreateTaskResponse201(body=_task())

    answers["create_task"] = create_task
    url = f"/v1/channels/{_CHANNEL_ID}/tasks"
    body = json.dumps({"title": "Write the guide"})
    headers = {**_bearer(), "Idempotency-Key": "k-orm"}

    async def post_twice() -> list[HttpResponseBase]:
        client = AsyncClient()
        return [
            await client.post(url, body, content_type="application/json", headers=headers),
            await client.post(url, body, content_type="application/json", headers=headers),
        ]

    with override_settings(
        MIDDLEWARE=[f"{_PACKAGE}.django.TasksBoundary"],
        SEAMPACT={"tasks": {**_settings(), "idempotency_store": f"{__name__}.database_store"}},
    ):
        first, replayed = asyncio.run(post_twice())

    assert (first.status_code, replayed.status_code) == (HTTPStatus.CREATED, HTTPStatus.CREATED), failures
    assert (len(created), failures) == (1, [])


def test_the_record_is_abandoned_when_the_handler_fails() -> None:
    def create_task(request: object) -> object:
        raise RuntimeError("a bug")

    answers["create_task"] = create_task

    response = _post(f"/v1/channels/{_CHANNEL_ID}/tasks", {"title": "Write the guide"})

    assert (response.status_code, idempotency_records) == (HTTPStatus.INTERNAL_SERVER_ERROR, {})


def test_the_record_is_abandoned_when_an_exception_propagates_into_the_boundary() -> None:
    answers["create_task"] = lambda _: _module("operations").CreateTaskResponse201(body=_task())

    with override_settings(DEBUG_PROPAGATE_EXCEPTIONS=True), pytest.raises(ValueError, match="after the view"):
        Client().post(
            f"/v1/channels/{_CHANNEL_ID}/tasks",
            json.dumps({"title": "Write the guide"}),
            content_type="application/json",
            headers={**_bearer(), "Idempotency-Key": "k-1", "X-Answer": "raise-after-view"},
        )

    assert idempotency_records == {}


def test_the_record_is_abandoned_when_the_reply_is_a_stream(caplog: pytest.LogCaptureFixture) -> None:
    answers["create_task"] = lambda _: _module("operations").CreateTaskResponse201(body=_task())

    with override_settings(SEAMPACT={"tasks": {**_settings(), "responses": "warn"}}):
        response = Client().post(
            f"/v1/channels/{_CHANNEL_ID}/tasks",
            json.dumps({"title": "Write the guide"}),
            content_type="application/json",
            headers={**_bearer(), "Idempotency-Key": "k-1", "X-Answer": "stream-after-view"},
        )
        b"".join(response.streaming_content)  # type: ignore[attr-defined]

    assert idempotency_records == {}
    assert "answered a stream" in caplog.text


def test_a_missing_empty_or_wildcard_if_match_is_precondition_required_before_the_header_check() -> None:
    answers["archive_task"] = lambda _: pytest.fail("the handler ran")
    url = f"/v1/channels/{_CHANNEL_ID}/tasks/{_USER_ID}/archive"

    for if_match in ({}, {"If-Match": ""}, {"If-Match": "*"}):
        response = Client().post(
            url,
            json.dumps({"reason": "done", "expectedVersion": 1}),
            content_type="application/json",
            headers={**_bearer(), "Idempotency-Key": "k-archive", **if_match},
        )

        assert response.status_code == HTTPStatus.PRECONDITION_REQUIRED, response.content
        assert _code(response) == "api.precondition_required"


@pytest.mark.parametrize("if_match", ['"7"', 'W/"7"'])
def test_a_strong_or_weak_if_match_tag_reaches_the_handler(if_match: str) -> None:
    answers["archive_task"] = lambda _: _module("operations").ArchiveTaskResponse200(body=_task())

    response = Client().post(
        f"/v1/channels/{_CHANNEL_ID}/tasks/{_USER_ID}/archive",
        json.dumps({"reason": "done", "expectedVersion": 1}),
        content_type="application/json",
        headers={**_bearer(), "Idempotency-Key": f"k-archive-{if_match}", "If-Match": if_match},
    )

    assert response.status_code == HTTPStatus.OK, response.content


def test_a_versioned_deprecated_write_hands_the_version_unquoted_and_writes_its_derived_headers() -> None:
    seen: list[object] = []

    def archive_task(request: object) -> object:
        seen.append(request)
        return _module("operations").ArchiveTaskResponse200(body=_task())

    answers["archive_task"] = archive_task
    url = f"/v1/channels/{_CHANNEL_ID}/tasks/{_USER_ID}/archive"

    response = Client().post(
        url,
        json.dumps({"reason": "done", "expectedVersion": 1}),
        content_type="application/json",
        headers={**_bearer(), "Idempotency-Key": "k-archive-headers", "If-Match": '"7"'},
    )

    assert response.status_code == HTTPStatus.OK, response.content
    assert seen[0].input.headers.if_match == "7"  # type: ignore[attr-defined]
    assert response.headers["ETag"] == '"1"'
    assert response.headers["Deprecation"] == "@1798761600"
    assert response.headers["Sunset"] == "Wed, 30 Jun 2027 00:00:00 GMT"
    assert response.headers["Link"] == f'</v1/channels/{_CHANNEL_ID}/tasks/{_USER_ID}>; rel="successor-version"'


def test_a_read_of_an_item_versioned_by_if_match_writes_its_version_tag() -> None:
    answers["get_task"] = lambda _: _module("operations").GetTaskResponse200(body=_task())

    response = Client().get(f"/v1/channels/{_CHANNEL_ID}/tasks/{_USER_ID}", headers=_bearer())

    assert response.status_code == HTTPStatus.OK, response.content
    assert response.headers["ETag"] == '"1"'
    assert "Deprecation" not in response.headers


@pytest.mark.parametrize("version", [2**63, -(2**53)])
def test_a_version_outside_the_safe_integers_is_the_apis_500_not_an_etag(version: int) -> None:
    task = dataclasses.replace(_task(), version=version)  # type: ignore[type-var]
    answers["get_task"] = lambda _: _module("operations").GetTaskResponse200(body=task)

    response = Client().get(f"/v1/channels/{_CHANNEL_ID}/tasks/{_USER_ID}", headers=_bearer())

    assert (response.status_code, _code(response)) == (HTTPStatus.INTERNAL_SERVER_ERROR, "api.internal")
    assert "ETag" not in response.headers
    assert [failure.operation for failure in failures] == [_GET_TASK]


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
    assert "operation 'getChannel' has no handler factory" in message
    assert "operation 'getChannel'" in message and "not its generated view" in message


class _AsyncHooks(_Hooks):
    async def decide(self, request: RequirementRequest, /) -> object:
        return decision.Allowed()


def async_hooks(request: HttpRequest) -> _AsyncHooks:
    return _AsyncHooks()


def test_the_boot_check_names_each_hook_the_contract_calls_and_settings_do_not_register() -> None:
    needs = hook_needs(_module("contract").CONTRACT)
    unregistered = {**_settings(), "authenticate": {}, "deciders": {}, "scope_resolvers": {}}

    with (
        override_settings(SEAMPACT={"tasks": unregistered}),
        pytest.raises(ImproperlyConfigured) as refused,
    ):
        Client().get("/v1/health")

    message = str(refused.value)
    assert needs.identities
    assert needs.scopes
    assert needs.deciders
    for identity in needs.identities:
        assert f"no authenticate hook for the identity '{identity}': " in message
    for scope in needs.scopes:
        assert f"no scope resolver for the scope '{scope}': " in message
    for decider in needs.deciders:
        assert f"no decider for '{decider}': " in message


def test_the_boot_check_refuses_the_urlconf_versions_and_async_methods_the_views_cannot_serve(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = ModuleType("seampact_drf_boundary_prefixed")
    root.__dict__["urlpatterns"] = [
        path("v1/channels/feed", lambda request: HttpResponse()),
        path("pre/", include(f"{_PACKAGE}.urls")),
        *i18n_patterns(path("", include(f"{_PACKAGE}.urls")), prefix_default_language=False),
    ]
    sys.modules[root.__name__] = root
    boundary = _module("django").TasksBoundary
    monkeypatch.setattr(
        boundary, "frameworks", (AcceptedFramework(package="django", unit=VersionUnit.MAJOR, accepted=("1",)),)
    )
    with_async_hook = _settings()
    with_async_hook["deciders"] = {name: f"{__name__}.async_hooks" for name in with_async_hook["deciders"]}  # type: ignore[attr-defined]

    with override_settings(ROOT_URLCONF=root.__name__, SEAMPACT={"tasks": with_async_hook}):
        problems = boot_problems(boundary)
        monkeypatch.setattr(
            boundary, "framework_routes", (FrameworkRouteRule(path="/v1/channels/*", method=None, reason="feed"),)
        )
        allow_listed = boot_problems(boundary)

    assert any(problem.startswith("django ") and "generated for django 1" in problem for problem in problems)
    assert any("under the prefix 'pre/'" in problem for problem in problems)
    assert any("under i18n_patterns()" in problem for problem in problems)
    assert any("'/v1/channels/feed' sits under the api's base path" in problem for problem in problems)
    assert any("method 'decide' is an async def" in problem for problem in problems)
    assert not any("/v1/channels/feed" in problem for problem in allow_listed)


def test_the_boot_check_names_the_prefixed_path_of_urls_included_off_the_mount() -> None:
    root = ModuleType("seampact_drf_boundary_off_the_mount")
    root.__dict__["urlpatterns"] = [path("mounted/", include(f"{_PACKAGE}.urls"))]
    sys.modules[root.__name__] = root

    with override_settings(ROOT_URLCONF=root.__name__, SEAMPACT={"tasks": _settings()}):
        problems = boot_problems(_module("django").TasksBoundary)

    assert any(
        problem.startswith(
            "operation 'health': no URL pattern serves /v1/health (its pattern sits at /mounted/v1/health)"
        )
        for problem in problems
    ), problems


def test_the_system_check_warns_and_seampact_check_fails_on_a_problem() -> None:
    with override_settings(MIDDLEWARE=["django.middleware.common.CommonMiddleware", *_middleware()]):
        warnings = [message for message in run_checks() if message.id == "seampact.tasks"]

        with pytest.raises(CommandError):
            call_command("seampact_check", stderr=StringIO())

    passing = StringIO()
    call_command("seampact_check", stdout=passing)

    assert any("not first in MIDDLEWARE" in warning.msg for warning in warnings)
    assert "passes" in passing.getvalue()


def test_seampact_check_and_the_system_check_pass_a_correct_app_in_a_fresh_process() -> None:
    checked = StringIO()

    with override_settings(ROOT_URLCONF=_fresh_root("seampact_drf_boundary_fresh_command").__name__):
        call_command("seampact_check", stdout=checked)

    with override_settings(ROOT_URLCONF=_fresh_root("seampact_drf_boundary_fresh_checks").__name__):
        warnings = [message.msg for message in run_checks() if message.id == "seampact.tasks"]

    assert "passes" in checked.getvalue()
    assert warnings == []


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("body_validation", True),
    ],
)
def test_a_setting_a_later_release_serves_is_refused_by_name(key: str, value: object) -> None:
    with (
        override_settings(SEAMPACT={"tasks": {**_settings(), key: value}}),
        pytest.raises(ImproperlyConfigured) as refused,
    ):
        Client().get("/v1/health")

    assert f"settings.SEAMPACT['tasks']['{key}']" in str(refused.value)
    assert "does not serve yet" in str(refused.value)


@pytest.mark.parametrize(
    ("own", "named"),
    [
        ({"responses": "bogus"}, "['responses'] is 'bogus'"),
        ({"operations": {"health": {"responses": "bogus"}}}, "['operations']['health']['responses'] is 'bogus'"),
        ({"operations": {"health": {"cache": "off"}}}, "['operations']['health'] has the unknown key 'cache'"),
        ({"operations": {"unknownOperation": {}}}, "the operation 'unknownOperation', which the api does not keep"),
        ({"operations": ["health"]}, "['operations'] is a list"),
    ],
)
def test_a_wrong_responses_or_operations_setting_is_refused_at_boot(own: dict[str, object], named: str) -> None:
    with (
        override_settings(SEAMPACT={"tasks": {**_settings(), **own}}),
        pytest.raises(ImproperlyConfigured) as refused,
    ):
        Client().get("/v1/health")

    assert named in str(refused.value)


def test_the_log_line_and_the_listener_name_the_class_and_place_and_the_message_only_under_debug(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def get_channel(request: object) -> object:
        raise ValueError(f"the handler broke with {_SECRET}")

    answers["get_channel"] = get_channel
    url = f"/v1/channels/{_CHANNEL_ID}"

    with caplog.at_level(logging.DEBUG, logger="seampact"):
        from_handler = Client().get(url, headers=_bearer())
        from_middleware = Client(raise_request_exception=False).get(url, headers={"X-Raise": "500"})

    assert (from_handler.status_code, from_middleware.status_code) == (500, 500)
    seampact_log = "\n".join(caplog.handler.format(item) for item in caplog.records if item.name.startswith("seampact"))
    assert "ValueError raised at" in seampact_log
    assert _SECRET not in seampact_log
    assert [_SECRET in failure.reason for failure in failures] == [False, False]
    assert all("ValueError raised at" in failure.reason for failure in failures)

    failures.clear()

    with override_settings(DEBUG=True):
        Client().get(url, headers=_bearer())

    assert _SECRET in failures[0].reason


def test_under_debug_only_djangos_technical_pages_leave_unchecked() -> None:
    with override_settings(DEBUG=True):
        app_page = Client().get("/v1/health", headers={"X-Answer": "html"})
        technical_404 = Client().get(f"/v1/channels/{_CHANNEL_ID}", headers={"X-Raise": "404"})

    assert (app_page.status_code, _code(app_page)) == (500, "api.internal")
    assert technical_404.status_code == HTTPStatus.NOT_FOUND


def test_an_inner_middleware_answering_no_response_gets_the_apis_500() -> None:
    # CommonMiddleware would fail on the missing response itself: the boundary must see it.
    beside_the_boundary = [f"{_PACKAGE}.django.TasksBoundary", f"{__name__}.RaisingMiddleware"]

    with override_settings(MIDDLEWARE=beside_the_boundary):
        response = Client().get("/v1/health", headers={"X-Answer": "none"})

        with override_settings(DEBUG_PROPAGATE_EXCEPTIONS=True), pytest.raises(Exception, match="not a response"):
            Client().get("/v1/health", headers={"X-Answer": "none"})

    assert (response.status_code, _code(response)) == (500, "api.internal")
    assert "not a response" in failures[0].reason


def test_a_stream_that_fails_after_its_head_ends_short_and_the_listener_hears_of_it() -> None:
    with override_settings(SEAMPACT={"tasks": {**_settings(), "responses": "warn"}}):
        response = Client().get("/v1/health", headers={"X-Answer": "stream"})
        body = b"".join(response.streaming_content)  # type: ignore[attr-defined]

    assert (response.status_code, body) == (200, b'{"status": ')
    assert any("ValueError raised at" in failure.reason for failure in failures)


def test_a_cors_preflight_on_a_contract_path_reaches_the_apps_cors_layer() -> None:
    preflight = {"Origin": "https://app.example.com", "Access-Control-Request-Method": "POST"}

    with override_settings(MIDDLEWARE=[*_middleware(), f"{__name__}.CorsMiddleware"]):
        answered = Client().options(f"/v1/channels/{_CHANNEL_ID}/tasks", headers=preflight)

    assert answered.status_code == HTTPStatus.OK
    assert answered["Access-Control-Allow-Origin"] == "https://app.example.com"


def test_a_cors_preflight_no_cors_layer_answers_and_a_plain_options_are_the_apis_404() -> None:
    preflight = {"Origin": "https://app.example.com", "Access-Control-Request-Method": "POST"}

    unanswered = Client().options(f"/v1/channels/{_CHANNEL_ID}/tasks", headers=preflight)
    plain = Client().options(f"/v1/channels/{_CHANNEL_ID}/tasks")

    for response in (unanswered, plain):
        assert (response.status_code, _code(response)) == (HTTPStatus.NOT_FOUND, "api.not_found")


def test_the_apps_drf_defaults_never_apply_to_a_contract_route() -> None:
    answers["health"] = lambda _: _module("operations").HealthResponse200(body=_module("schemas").Health(status="ok"))
    answers["get_channel"] = lambda _: _module("operations").GetChannelResponse200(
        body=_module("schemas").Channel(channel_id=_uuid(_CHANNEL_ID), name="general")
    )
    refusing_defaults = {
        "DEFAULT_AUTHENTICATION_CLASSES": [f"{__name__}.RefusingAuthentication"],
        "DEFAULT_PERMISSION_CLASSES": [f"{__name__}.DenyingPermission"],
        "DEFAULT_THROTTLE_CLASSES": [f"{__name__}.ExhaustedThrottle"],
    }

    with override_settings(REST_FRAMEWORK=refusing_defaults):
        public = Client().get("/v1/health")
        identity = Client().get(f"/v1/channels/{_CHANNEL_ID}", headers=_bearer())

    assert (public.status_code, identity.status_code) == (HTTPStatus.OK, HTTPStatus.OK), identity.content


@pytest.mark.parametrize(
    ("classes", "headers", "expected"),
    [
        (
            {"authentication_classes": ["BearerAuthentication"], "permission_classes": ["IsAuthenticated"]},
            {},
            (HTTPStatus.UNAUTHORIZED, "api.unauthenticated"),
        ),
        (
            {"authentication_classes": ["RefusingAuthentication"]},
            _BEARER,
            (HTTPStatus.UNAUTHORIZED, "api.unauthenticated"),
        ),
        ({"permission_classes": ["DenyingPermission"]}, _BEARER, (HTTPStatus.FORBIDDEN, "api.forbidden")),
        ({"authentication_classes": ["ForbiddingAuthentication"]}, _BEARER, (HTTPStatus.FORBIDDEN, "api.forbidden")),
        ({"throttle_classes": ["ExhaustedThrottle"]}, _BEARER, (HTTPStatus.TOO_MANY_REQUESTS, "api.rate_limited")),
    ],
)
def test_drfs_exceptions_on_the_operations_access_kind_answer_their_contract_role(
    classes: dict[str, list[str]], headers: dict[str, str], expected: tuple[int, str]
) -> None:
    answers["create_task"] = lambda _: pytest.fail("the handler ran")
    access = {"identity": {name: [_class_path(short) for short in paths] for name, paths in classes.items()}}

    with override_settings(SEAMPACT={"tasks": {**_settings(), "access": access}}):
        response = _create_task(Client(), headers)

    assert (response.status_code, _code(response)) == expected


def test_the_classes_of_one_access_kind_never_reach_another_and_the_hook_factory_reads_drfs_user() -> None:
    answers["health"] = lambda _: _module("operations").HealthResponse200(body=_module("schemas").Health(status="ok"))
    answers["get_channel"] = lambda _: _module("operations").GetChannelResponse200(
        body=_module("schemas").Channel(channel_id=_uuid(_CHANNEL_ID), name="general")
    )
    access = {
        "identity": {
            "authentication_classes": [f"{__name__}.BearerAuthentication"],
            "permission_classes": ["rest_framework.permissions.IsAuthenticated"],
        }
    }
    authenticate = _settings()["authenticate"]
    assert isinstance(authenticate, dict)
    own = {**_settings(), "access": access, "authenticate": {**authenticate, "user": f"{__name__}.user_reading_hooks"}}

    with override_settings(SEAMPACT={"tasks": own}):
        public = Client().get("/v1/health")
        identity = Client().get(f"/v1/channels/{_CHANNEL_ID}", headers=_bearer())

    assert (public.status_code, identity.status_code) == (HTTPStatus.OK, HTTPStatus.OK), identity.content
    # DRF sets its anonymous user on a kind without authentication classes.
    assert [type(user) for user in hook_factory_users] == [AnonymousUser, TokenUser]


def test_the_boot_check_refuses_an_access_setting_it_cannot_use_by_name() -> None:
    access = {
        "authenticated": {},
        "optional": {"permission_classes": []},
        "identity": {
            "renderer_classes": [],
            "authentication_classes": "rest_framework.authentication.SessionAuthentication",
            "permission_classes": ["app.missing.Permission"],
        },
        "signed": {"permission_classes": ["rest_framework.authentication.SessionAuthentication"]},
    }

    with (
        override_settings(SEAMPACT={"tasks": {**_settings(), "access": access}}),
        pytest.raises(ImproperlyConfigured) as refused,
    ):
        Client().get("/v1/health")

    setting = "settings.SEAMPACT['tasks']['access']"
    for problem in (
        f"{setting} has the unknown access kind 'authenticated'",
        f"{setting} names the access kind 'optional', which no operation of the api has",
        f"{setting}['identity'] has the unknown key 'renderer_classes'",
        f"{setting}['identity']['authentication_classes'] must be a list of dotted paths",
        f"{setting}['identity']['permission_classes'] names 'app.missing.Permission', which does not import",
        "names 'rest_framework.authentication.SessionAuthentication', which is no BasePermission subclass",
    ):
        assert problem in str(refused.value)


def test_session_authentication_checks_djangos_csrf_token_only_for_a_session_users_unsafe_request(
    session_user: User,
) -> None:
    answers["create_task"] = lambda _: _module("operations").CreateTaskResponse201(body=_task())
    answers["get_channel"] = lambda _: _module("operations").GetChannelResponse200(
        body=_module("schemas").Channel(channel_id=_uuid(_CHANNEL_ID), name="general")
    )
    signed_in = Client(enforce_csrf_checks=True)
    signed_in.force_login(session_user)
    with_token = Client(enforce_csrf_checks=True)
    with_token.force_login(session_user)
    with_token.cookies[settings.CSRF_COOKIE_NAME] = _CSRF_SECRET
    access = {"identity": {"authentication_classes": ["rest_framework.authentication.SessionAuthentication"]}}

    with override_settings(SEAMPACT={"tasks": {**_settings(), "access": access}}, MIDDLEWARE=_session_middleware()):
        without_token = _create_task(signed_in, _BEARER, "k-session-1")
        read = signed_in.get(f"/v1/channels/{_CHANNEL_ID}", headers=_bearer())
        tokened = _create_task(with_token, {**_BEARER, "X-CSRFToken": _CSRF_SECRET}, "k-session-2")
        anonymous = _create_task(Client(enforce_csrf_checks=True), _BEARER, "k-session-3")

    assert (without_token.status_code, _code(without_token)) == (HTTPStatus.FORBIDDEN, "api.csrf_invalid")
    assert read.status_code == HTTPStatus.OK, read.content
    assert tokened.status_code == HTTPStatus.CREATED, _code(tokened)
    assert anonymous.status_code == HTTPStatus.CREATED, _code(anonymous)


@pytest.fixture
def session_user() -> User:
    call_command("migrate", verbosity=0)
    return User.objects.create_user(username=f"ada-{User.objects.count()}")


def _create_task(client: Client, headers: dict[str, str], idempotency_key: str = "k-1") -> HttpResponseBase:
    return client.post(
        f"/v1/channels/{_CHANNEL_ID}/tasks",
        json.dumps({"title": "Write the guide"}),
        content_type="application/json",
        headers={**headers, "Idempotency-Key": idempotency_key},
    )


def _class_path(short_name: str) -> str:
    return f"{_DRF_PERMISSIONS}.{short_name}" if short_name == "IsAuthenticated" else f"{__name__}.{short_name}"


def _session_middleware() -> list[str]:
    return [
        f"{_PACKAGE}.django.TasksBoundary",
        "django.contrib.sessions.middleware.SessionMiddleware",
        "django.middleware.csrf.CsrfViewMiddleware",
        "django.contrib.auth.middleware.AuthenticationMiddleware",
        "django.middleware.common.CommonMiddleware",
    ]


def _write_absolute_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    api = ir_map(_module("contract").CONTRACT.ir_view, "api")
    assert isinstance(api, dict)
    monkeypatch.setitem(api["wire"], "urls", "absolute")


def _fresh_root(name: str) -> ModuleType:
    """A root URLconf whose error handlers no boundary wrapped yet, as in a process that built no request handler."""
    root = ModuleType(name)
    root.__dict__["urlpatterns"] = [path("", include(f"{_PACKAGE}.urls"))]
    sys.modules[name] = root

    return root


def _served_ir(repository_root: Path) -> dict[str, JsonValue]:
    """The reference contract, `archiveTask` versioned by `If-Match` with the two codes the compiler derives for a
    header version."""
    ir = reference_ir(repository_root, "tasks")
    catalogue = ir["errors"]
    assert isinstance(catalogue, dict)
    conflict = catalogue["state.conflict"]
    assert isinstance(conflict, dict)
    archive = _item(ir["operations"], "id", _ARCHIVE_TASK)
    concurrency = archive["concurrency"]
    assert isinstance(concurrency, dict)
    concurrency["version"] = {"in": "header", "name": "If-Match"}
    params = archive["params"]
    assert isinstance(params, dict) and isinstance(params["header"], list) and isinstance(archive["errors"], list)
    params["header"].append(
        {"name": "If-Match", "required": True, "type": {"kind": "scalar", "refinements": {}, "type": "string"}}
    )

    for code, status, role in _PRECONDITION_CODES:
        catalogue[code] = {**conflict, "code": code, "default": role, "http": {"status": status}}
        archive["errors"].append({"code": code, "derivedFrom": concurrency["derivedFrom"], "roles": [{"role": role}]})

    _with_a_deadline(ir, reference_ir(repository_root, "tasksService"), _CREATE_TASK)
    _with_response_headers(ir, archive, concurrency)

    return ir


def _with_response_headers(
    ir: dict[str, JsonValue], archive: dict[str, JsonValue], concurrency: dict[str, JsonValue]
) -> None:
    """`archiveTask` deprecated for `getTask`, with the headers the compiler derives: its Deprecation, Sunset and
    successor Link, and the version's ETag on both, the read's derived from the write's `concurrency`."""
    derived_from = concurrency["derivedFrom"]
    assert isinstance(derived_from, dict)
    origin: JsonValue = {
        "layer": "api",
        "pointer": "/surfaces/app/routes/channels/member/routes/tasks/archive/deprecated",
    }
    archive["deprecated"] = {
        "since": "2027-01-01",
        "sunset": "2027-06-30",
        "successor": {"api": "tasks", "id": _GET_TASK, "kind": "httpOperation"},
        "successorRel": "successor-version",
        "origin": origin,
    }
    text: JsonValue = {"kind": "scalar", "refinements": {}, "type": "string"}
    deprecation: JsonValue = {"derivation": "deprecation.headers", "from": [origin]}
    entity_tag: JsonValue = {"name": "ETag", "type": text, "required": True, "derivedFrom": derived_from}
    deprecation_headers: list[JsonValue] = [
        {"name": name, "type": text, "required": True, "semantic": semantic, "derivedFrom": deprecation}
        for name, semantic in (("Deprecation", "deprecation"), ("Sunset", "sunset"), ("Link", "successorLink"))
    ]

    for operation, headers in (
        (archive, [entity_tag, *deprecation_headers]),
        (_item(ir["operations"], "id", _GET_TASK), [entity_tag]),
    ):
        responses = operation["responses"]
        assert isinstance(responses, list) and isinstance(responses[0], dict)
        responses[0]["headers"] = headers


def _with_a_deadline(ir: dict[str, JsonValue], service_ir: dict[str, JsonValue], operation_id: str) -> None:
    """The operation reads the service api's optional deadline header, with its code: no reference operation has both
    a deadline and an input field right."""
    deadline_reader = _item(service_ir["operations"], "id", _GET_TASK)
    header = deadline_reader["deadlineHeader"]
    reader_params, catalogue, service_catalogue = deadline_reader["params"], ir["errors"], service_ir["errors"]
    assert isinstance(header, str) and isinstance(reader_params, dict)
    assert isinstance(catalogue, dict) and isinstance(service_catalogue, dict)
    read_by = _item(ir["operations"], "id", operation_id)
    params, errors = read_by["params"], read_by["errors"]
    assert isinstance(params, dict) and isinstance(params["header"], list) and isinstance(errors, list)

    read_by["deadlineHeader"] = header
    params["header"].append({**_item(reader_params["header"], "name", header), "required": False})
    errors.append(_item(deadline_reader["errors"], "code", _DEADLINE_EXCEEDED))
    catalogue[_DEADLINE_EXCEEDED] = service_catalogue[_DEADLINE_EXCEEDED]


def _item(items: JsonValue, key: str, value: str) -> dict[str, JsonValue]:
    """The member of a list of IR objects whose `key` is `value`."""
    assert isinstance(items, list)
    found = next(item for item in items if isinstance(item, dict) and item.get(key) == value)
    assert isinstance(found, dict)
    return found


def _settings() -> dict[str, object]:
    contract_view = importlib.import_module(f"{_PACKAGE}.contract").CONTRACT
    operations = [contract_view.operation(operation_id) for operation_id in contract_view.operation_ids()]
    identities = {ir_string(ir_map(item, "access"), "identity") for item in operations} - {None}
    deciders = hook_needs(contract_view).deciders
    scopes = hook_needs(contract_view).scopes
    resources = importlib.import_module(f"{_PACKAGE}.django").TasksBoundary.handler_resources

    return {
        "handlers": {resource: f"{__name__}.handlers" for resource in resources},
        "authenticate": {str(name): f"{__name__}.hooks" for name in identities},
        "deciders": {str(name): f"{__name__}.hooks" for name in deciders},
        "scope_resolvers": {str(name): f"{__name__}.hooks" for name in scopes},
        "on_unexpected_error": f"{__name__}.listener",
        "idempotency_store": f"{__name__}.store",
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
