"""Absolute URLs on the FastAPI placement: page links start with the `public_origin` argument of `bind_<api>()`, never
the request's host, and the boot check names a missing origin under absolute URLs and a set one under relative URLs."""

from typing import Final

import fastapi
import pytest
from fastapi.testclient import TestClient

from seampact.codegen.runtime.ir_view import ir_map
from seampact.fastapi.runtime.boot_check import boot_problems

from .golden_app import NEXT_CURSOR, bound_app, golden_module, served

_ORIGIN: Final = "https://api.example.com"
_SETTING: Final = "the `public_origin` argument of bind_tasks()"


def _write_absolute_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    api = ir_map(golden_module("contract").CONTRACT.ir_view, "api")
    wire = api.get("wire")
    assert isinstance(wire, dict)
    monkeypatch.setitem(wire, "urls", "absolute")


def test_page_links_start_with_the_public_origin_under_absolute_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    _write_absolute_urls(monkeypatch)
    client = TestClient(served(public_origin=_ORIGIN), base_url="http://internal.host")

    response = client.get("/v1/channels", headers={"Authorization": "Bearer any"})

    assert response.status_code == 200
    links = response.headers.get("link", "") + response.text
    assert f"{_ORIGIN}/v1/channels?" in links
    assert "internal.host" not in links


def test_page_links_keep_the_mount_prefix_under_a_parent_mount(monkeypatch: pytest.MonkeyPatch) -> None:
    _write_absolute_urls(monkeypatch)
    parent = fastapi.FastAPI()
    parent.mount("/svc", served(public_origin=_ORIGIN))
    client = TestClient(parent)

    response = client.get("/svc/v1/channels", headers={"Authorization": "Bearer any"})

    assert response.status_code == 200
    links = response.headers.get("link", "") + response.text
    assert f"{_ORIGIN}/svc/v1/channels?" in links


def test_page_links_stay_relative_under_relative_urls() -> None:
    client = TestClient(served())

    response = client.get("/v1/channels", headers={"Authorization": "Bearer any"})

    assert response.status_code == 200
    assert response.headers.get("link") == f'<?cursor={NEXT_CURSOR}>; rel="next"'


def test_the_boot_check_names_a_missing_public_origin_under_absolute_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    _write_absolute_urls(monkeypatch)
    _, binding = bound_app()

    problems = [problem for problem in boot_problems(binding) if _SETTING in problem]

    assert len(problems) == 1
    assert "is not set" in problems[0]


def test_the_boot_check_names_a_public_origin_set_under_relative_urls() -> None:
    _, binding = bound_app(public_origin=_ORIGIN)

    problems = [problem for problem in boot_problems(binding) if _SETTING in problem]

    assert len(problems) == 1
    assert "writes relative URLs" in problems[0]


def test_the_boot_check_accepts_a_valid_public_origin_under_absolute_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    _write_absolute_urls(monkeypatch)
    _, binding = bound_app(public_origin=_ORIGIN)

    assert not [problem for problem in boot_problems(binding) if _SETTING in problem]
