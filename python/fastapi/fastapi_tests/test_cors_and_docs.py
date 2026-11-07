"""CORS and FastAPI's documentation routes beside the boundary (ADR 0026 "Routes" and "Native docs"): the app's
`CORSMiddleware`, added before `bind_<api>()`, answers a preflight on a contract path and adds its headers to a
contract reply; one added after is refused at boot. `/docs` and `/openapi.json` stay the app's, and with `nativeDocs`
off FastAPI's document holds none of the contract routes."""

from typing import Final

import fastapi
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from seampact.fastapi.runtime.boot_check import boot_problems

from .golden_app import bound_app, served

_APP_ORIGIN: Final = "https://app.example.com"
_LIST_CHANNELS: Final = "/v1/channels"
_ALLOW_ORIGIN: Final = "access-control-allow-origin"
_PREFLIGHT_HEADERS: Final = {"Origin": _APP_ORIGIN, "Access-Control-Request-Method": "GET"}


def _with_cors(app: fastapi.FastAPI) -> None:
    app.add_middleware(CORSMiddleware, allow_origins=[_APP_ORIGIN], allow_methods=["*"], allow_headers=["*"])


def test_the_apps_cors_middleware_answers_a_preflight_on_a_contract_path() -> None:
    client = TestClient(served(before_bind=_with_cors))

    response = client.options(_LIST_CHANNELS, headers=_PREFLIGHT_HEADERS)

    assert response.status_code == 200
    assert response.headers.get(_ALLOW_ORIGIN) == _APP_ORIGIN


def test_an_options_request_that_is_no_preflight_answers_the_paths_not_found() -> None:
    client = TestClient(served(before_bind=_with_cors))

    response = client.options(_LIST_CHANNELS, headers={"Origin": _APP_ORIGIN})

    assert response.status_code == 404


def test_a_preflight_without_a_cors_middleware_answers_the_paths_not_found() -> None:
    client = TestClient(served())

    response = client.options(_LIST_CHANNELS, headers=_PREFLIGHT_HEADERS)

    assert response.status_code == 404


def test_the_apps_cors_middleware_adds_its_headers_to_a_contract_reply() -> None:
    client = TestClient(served(before_bind=_with_cors))

    response = client.get(_LIST_CHANNELS, headers={"Origin": _APP_ORIGIN, "Authorization": "Bearer any"})

    assert response.status_code == 200
    assert response.headers.get(_ALLOW_ORIGIN) == _APP_ORIGIN


def test_a_cors_middleware_added_after_bind_fails_the_boot_check() -> None:
    app, binding = bound_app()
    _with_cors(app)

    assert any("is not the outermost middleware" in problem for problem in boot_problems(binding))


def test_the_docs_routes_stay_the_apps_and_leave_the_contract_routes_out() -> None:
    client = TestClient(served())

    document = client.get("/openapi.json")

    assert client.get("/docs").status_code == 200
    assert document.status_code == 200
    assert not any(path.startswith("/v1/") for path in document.json()["paths"])
