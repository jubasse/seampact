"""The public origin absolute URLs start with, and its boot check, with the PHP runtime's vectors."""

from typing import Final

import pytest

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.public_origin import configured_origin, public_origin_problem, writes_absolute_urls

_SETTING: Final = "settings.SEAMPACT['tasks']['public_origin']"


def _contract(urls: str) -> ApiContract:
    return ApiContract(
        api="tasks",
        generated_by="0.0.0-dev",
        mount="",
        ir_view={"api": {"id": "tasks", "wire": {"urls": urls}}},
        members={},
        operation_members={},
    )


def test_relative_urls_need_no_origin() -> None:
    contract = _contract("relative")

    assert not writes_absolute_urls(contract)
    assert public_origin_problem(contract, _SETTING, None) is None
    assert public_origin_problem(contract, _SETTING, "") is None
    assert configured_origin(contract, "https://api.example.com") is None


def test_relative_urls_refuse_an_origin_that_is_set_naming_the_setting_and_the_fix() -> None:
    problem = public_origin_problem(_contract("relative"), _SETTING, "https://api.example.com") or ""

    assert _SETTING in problem
    assert "relative URLs" in problem
    assert "remove it" in problem


def test_absolute_urls_without_the_origin_are_a_boot_problem_naming_the_setting() -> None:
    problem = public_origin_problem(_contract("absolute"), _SETTING, None) or ""

    assert _SETTING in problem
    assert "is not set" in problem


@pytest.mark.parametrize(
    "origin",
    [
        pytest.param("https://api.example.com/", id="a trailing slash"),
        pytest.param("https://api.example.com/v1", id="a path"),
        pytest.param("api.example.com", id="no scheme"),
        pytest.param("ftp://api.example.com", id="another scheme"),
        pytest.param("https://user@api.example.com", id="user info"),
        pytest.param("https://api.example.com?x=1", id="a query"),
        pytest.param("https://exa mple.com", id="a space in the host"),
        pytest.param("https://a.com\r\nX-Evil: 1", id="a line break"),
        pytest.param("https://a<b>.com", id="angle brackets"),
        pytest.param("https://a.com\0", id="a NUL byte"),
        pytest.param("https://a.com:", id="an empty port"),
        pytest.param("https://a.com:70000", id="a port past 65535"),
        pytest.param("https://a.com:0", id="port zero"),
    ],
)
def test_an_origin_that_is_not_scheme_host_and_port_is_a_boot_problem(origin: str) -> None:
    contract = _contract("absolute")

    assert public_origin_problem(contract, _SETTING, origin) is not None
    assert configured_origin(contract, origin) is None


def test_a_refused_origin_is_shown_escaped_in_the_problem() -> None:
    problem = public_origin_problem(_contract("absolute"), _SETTING, "https://a.com\r\nX-Evil: 1") or ""

    assert "\r" not in problem
    assert "\n" not in problem
    assert "\\r\\n" in problem


def test_an_origin_that_is_not_a_string_is_a_boot_problem_naming_its_type() -> None:
    problem = public_origin_problem(_contract("absolute"), _SETTING, 443) or ""

    assert "is int, which is not a string" in problem


@pytest.mark.parametrize("origin", ["https://api.example.com:8443", "http://10.0.0.1", "https://[::1]:8080"])
def test_a_scheme_host_and_port_is_the_origin(origin: str) -> None:
    contract = _contract("absolute")

    assert public_origin_problem(contract, _SETTING, origin) is None
    assert configured_origin(contract, origin) == origin
