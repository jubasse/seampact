"""A CORS preflight is an `OPTIONS` request carrying both `Origin` and `Access-Control-Request-Method`, as the PHP
boundaries read it."""

from seampact.codegen.runtime.cors_preflight import is_cors_preflight


def test_an_options_request_with_origin_and_requested_method_is_a_preflight() -> None:
    assert is_cors_preflight("OPTIONS", ["Origin", "Access-Control-Request-Method"])


def test_an_options_request_without_the_requested_method_is_no_preflight() -> None:
    assert not is_cors_preflight("OPTIONS", ["origin"])


def test_an_options_request_without_origin_is_no_preflight() -> None:
    assert not is_cors_preflight("OPTIONS", ["access-control-request-method"])


def test_another_method_with_both_headers_is_no_preflight() -> None:
    assert not is_cors_preflight("GET", ["origin", "access-control-request-method"])
