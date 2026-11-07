"""The `frameworkRoutes` allow-list rule (ADR 0011 "The app config"): `*` takes one segment, `**` any number including
none, a `*` inside a segment any characters but `/`, empty segments are dropped, a param is one segment and a catch-all
segment is taken only by `**`. The vectors are the ones every server target shares."""

from typing import Final

import pytest

from seampact.codegen.runtime.framework_routes import FrameworkRouteRule, allow_listed

_VECTORS: Final = (
    ("a literal path", "/metrics", "/metrics", True),
    ("another literal path", "/metrics", "/health", False),
    ("'*' over one literal segment", "/admin/*", "/admin/queues", True),
    ("'*' over a param", "/orders/*", "/orders/{id}", True),
    ("'*' over two segments", "/admin/*", "/admin/queues/jobs", False),
    ("'*' over a catch-all", "/files/*", "/files/{*rest}", False),
    ("'**' over zero segments", "/actuator/**", "/actuator", True),
    ("'**' over several segments", "/actuator/**", "/actuator/health/{id}", True),
    ("'**' over a catch-all", "/files/**", "/files/{*rest}", True),
    ("'**' stops at a segment boundary", "/actuator/**", "/actuatorX", False),
    ("'**' between segments over zero segments", "/a/**/z", "/a/z", True),
    ("'**' between segments over several", "/a/**/z", "/a/b/c/z", True),
    ("'*' inside a segment", "/livewire-*/**", "/livewire-3f9a/upload-file", True),
    ("'*' inside a segment keeps its literal parts", "/report-*.csv", "/report-2026.csv", True),
    ("'*' inside a segment needs its literal parts", "/report-*.csv", "/report.txt", False),
    ("empty segments dropped on both sides", "//admin//health/", "/admin/health", True),
    ("a param taken by a literal pattern segment", "/orders/latest", "/orders/{id}", False),
)


@pytest.mark.parametrize(("name", "allowed", "route", "allows"), _VECTORS, ids=[vector[0] for vector in _VECTORS])
def test_the_allow_list_takes_the_routes_every_target_takes(name: str, allowed: str, route: str, allows: bool) -> None:
    rule = FrameworkRouteRule(path=allowed, method=None, reason="test")

    assert allow_listed([rule], route, "GET") is allows


@pytest.mark.parametrize("route", ["/files/{rest:path}", "/files/{*rest}"])
def test_a_catch_all_route_of_either_spelling_is_taken_only_by_a_double_star(route: str) -> None:
    single = FrameworkRouteRule(path="/files/*", method=None, reason="test")
    double = FrameworkRouteRule(path="/files/**", method=None, reason="test")

    assert allow_listed([single], route, "GET") is False
    assert allow_listed([double], route, "GET") is True


def test_a_rule_for_one_method_does_not_take_another() -> None:
    rule = FrameworkRouteRule(path="/metrics", method="GET", reason="test")

    assert allow_listed([rule], "/metrics", "GET")
    assert not allow_listed([rule], "/metrics", "POST")
