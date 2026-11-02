"""The suite's control routes (ADR 0015 "Control routes") as Django views, outside the api's base path."""

from django.http import HttpRequest, HttpResponse
from django.views.decorators.http import require_GET, require_http_methods
from seampact_consumer_suite.control_routes import ControlReply, hook_calls_reply, log_lines_reply, script_reply


def _response(reply: ControlReply) -> HttpResponse:
    return HttpResponse(reply.body, status=reply.status, content_type=reply.content_type)


@require_http_methods(["PUT"])
def load_script(request: HttpRequest) -> HttpResponse:
    return _response(script_reply(request.body))


@require_GET
def hook_calls(request: HttpRequest) -> HttpResponse:
    return _response(hook_calls_reply())


@require_GET
def log_lines(request: HttpRequest) -> HttpResponse:
    return _response(log_lines_reply())
