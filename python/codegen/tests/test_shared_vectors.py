"""The cross-language vectors of `fixtures/vectors/`, which the Node, Spring Boot and PHP runtimes read too."""

import json
import re
from pathlib import Path
from typing import Any, Final

import pytest

from seampact.codegen.runtime.cache_headers import strong_etag
from seampact.codegen.runtime.digests import canonical, hex_of
from seampact.codegen.runtime.framework_routes import FrameworkRouteRule, allow_listed
from seampact.codegen.runtime.version import accepts

# python/codegen/tests/test_shared_vectors.py: the repository root is three directories up from this one.
_VECTORS: Final = Path(__file__).resolve().parents[3] / "fixtures" / "vectors"
_CATCH_ALL: Final = re.compile(r"\{\*(\w+)\}")
# Where the Python allow-list reads a pattern as a regular expression over the route's text, not segment by segment as
# the Node, Spring Boot and PHP targets do: a known divergence, strict so the fix removes it from this list.
_ROUTE_PATTERN_DIVERGENCES: Final = {
    "'*' over a catch-all",
    "'**' over zero segments",
    "'**' between segments over zero segments",
    "empty segments dropped on both sides",
}


def _vectors(file: str) -> dict[str, Any]:
    vectors: dict[str, Any] = json.loads((_VECTORS / file).read_text(encoding="utf-8"))

    return vectors


def _named(vectors: list[dict[str, Any]]) -> list[Any]:
    return [pytest.param(vector, id=vector["name"]) for vector in vectors]


@pytest.mark.parametrize("vector", _named(_vectors("digests.json")["canonical"]))
def test_digest_vector(vector: dict[str, Any]) -> None:
    assert canonical(vector["parts"]) == vector["text"]
    assert hex_of(vector["parts"]) == vector["hex"]


@pytest.mark.parametrize("vector", _named(_vectors("digests.json")["bodies"]))
def test_etag_vector(vector: dict[str, Any]) -> None:
    assert strong_etag(vector["body"].encode("utf-8")) == f'"{vector["base64Url"]}"'


def _route_pattern_vectors() -> list[Any]:
    return [
        pytest.param(
            vector,
            id=vector["name"],
            marks=pytest.mark.xfail(strict=True, reason="the Python allow-list diverges")
            if vector["name"] in _ROUTE_PATTERN_DIVERGENCES
            else (),
        )
        for vector in _vectors("framework-route-patterns.json")["vectors"]
    ]


@pytest.mark.parametrize("vector", _route_pattern_vectors())
def test_route_pattern_vector(vector: dict[str, Any]) -> None:
    # The vectors write a catch-all `{*name}`; Starlette writes it `{name:path}`.
    route = _CATCH_ALL.sub(r"{\1:path}", vector["route"])
    rules = [FrameworkRouteRule(path=vector["allowed"], method=None, reason="a vector")]

    assert allow_listed(rules, route, "GET") is vector["allows"]


@pytest.mark.parametrize(
    "vector",
    [
        pytest.param(vector, id=f"{vector['installed']} serves {vector['generator']}")
        for vector in _vectors("runtime-versions.json")["vectors"]
    ],
)
def test_runtime_version_vector(vector: dict[str, Any]) -> None:
    assert accepts(vector["generator"], vector["installed"]) is vector["serves"]
