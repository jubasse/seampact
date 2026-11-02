"""The raw request target of ASGI and WSGI servers and its match against the reference contract's routes."""

import json
from pathlib import Path

import pytest

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.raw_target import RawTarget, asgi_raw_target, wsgi_raw_target
from seampact.codegen.runtime.route_match import RouteMatch

_TASK = "/v1/channels/c1/tasks"


@pytest.fixture(scope="module")
def tasks(repository_root: Path) -> ApiContract:
    ir_view = json.loads((repository_root / "fixtures/golden/reference/tasks.ir.json").read_text(encoding="utf-8"))

    return ApiContract(api="tasks", generated_by="0.0.0-dev", mount="", ir_view=ir_view, members={})


def test_asgi_takes_the_raw_path_as_sent_and_the_raw_query() -> None:
    scope = {"raw_path": b"/v1/tasks/%73earch", "path": "/v1/tasks/search", "query_string": b"a=%20b"}

    assert asgi_raw_target(scope) == RawTarget("/v1/tasks/%73earch", "a=%20b", raw=True)


def test_asgi_strips_a_raw_prefix_equal_to_the_root_path() -> None:
    scope = {"raw_path": b"/api/v1/health", "root_path": "/api", "query_string": b""}

    assert asgi_raw_target(scope) == RawTarget("/v1/health", "", raw=True)


def test_asgi_strips_a_root_path_sent_as_utf8_bytes() -> None:
    scope = {"raw_path": "/café/v1".encode(), "root_path": "/café"}

    assert asgi_raw_target(scope) == RawTarget("/v1", "", raw=True)


@pytest.mark.parametrize("raw_path", [b"/v1/health", b"/apix/v1/health"])
def test_asgi_target_outside_the_root_path_is_not_a_contract_request(raw_path: bytes) -> None:
    assert asgi_raw_target({"raw_path": raw_path, "root_path": "/api"}) is None


def test_asgi_without_raw_path_falls_back_to_the_decoded_path() -> None:
    assert asgi_raw_target({"path": "/v1/tasks/search"}) == RawTarget("/v1/tasks/search", "", raw=False)


def test_asgi_keeps_only_the_path_of_an_absolute_form_target() -> None:
    target = asgi_raw_target({"raw_path": b"http://example.test/v1/health?x=1"})

    assert target == RawTarget("/v1/health", "", raw=True)


def test_wsgi_takes_the_raw_uri_minus_the_script_name() -> None:
    environ = {"RAW_URI": "/app/v1/a%2Fb?x=1", "SCRIPT_NAME": "/app", "QUERY_STRING": "x=1", "PATH_INFO": "/v1/a/b"}

    assert wsgi_raw_target(environ) == RawTarget("/v1/a%2Fb", "x=1", raw=True)


@pytest.mark.parametrize("uri", ["/v1/health", "/application/v1/health"])
def test_wsgi_target_outside_the_script_name_is_not_a_contract_request(uri: str) -> None:
    assert wsgi_raw_target({"RAW_URI": uri, "SCRIPT_NAME": "/app", "PATH_INFO": "/v1/health"}) is None


def test_wsgi_without_a_raw_uri_falls_back_to_the_decoded_path_info() -> None:
    assert wsgi_raw_target({"PATH_INFO": "/v1/a/b"}) == RawTarget("/v1/a/b", "", raw=False)


@pytest.mark.parametrize(
    ("method", "raw_path", "expected"),
    [
        ("GET", f"{_TASK}/t1", RouteMatch("getTask", {"channelId": "c1", "taskId": "t1"})),
        ("HEAD", f"{_TASK}/t1", RouteMatch("getTask", {"channelId": "c1", "taskId": "t1"})),
        ("POST", f"{_TASK}/search", RouteMatch("searchTasks", {"channelId": "c1"})),
        ("GET", f"{_TASK}/%73earch", RouteMatch("getTask", {"channelId": "c1", "taskId": "%73earch"})),
        ("GET", f"{_TASK}/a%2Fb", RouteMatch("getTask", {"channelId": "c1", "taskId": "a%2Fb"})),
        ("GET", f"{_TASK}/t1/", RouteMatch(None, {})),
        ("GET", "/v1/channels//tasks", RouteMatch(None, {})),
        ("GET", f"{_TASK}/%2e%2e", RouteMatch(None, {})),
        ("GET", f"{_TASK}/7%3Bx=1", RouteMatch("getTask", {"channelId": "c1", "taskId": "7%3Bx=1"})),
        ("GET", f"{_TASK}/7;x=1", RouteMatch(None, {})),
        ("PUT", f"{_TASK}/t1", RouteMatch(None, {})),
        ("GET", "/v2/health", None),
        ("GET", "/v10/health", None),
    ],
)
def test_the_raw_path_matches_the_contract_templates(
    tasks: ApiContract, method: str, raw_path: str, expected: RouteMatch | None
) -> None:
    assert tasks.match(method, raw_path) == expected


def test_a_mount_prefixes_every_template_and_base_path(tasks: ApiContract) -> None:
    mounted = ApiContract(api="tasks", generated_by="0.0.0-dev", mount="/api", ir_view=tasks.ir_view, members={})

    assert mounted.match("GET", "/api/v1/health") == RouteMatch("health", {})
    assert mounted.match("GET", "/v1/health") is None
    assert mounted.base_paths() == ("/api/v1", "/api/v1/hooks")
