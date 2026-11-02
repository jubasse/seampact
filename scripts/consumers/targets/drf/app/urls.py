"""The root URLconf of the DRF consumer: the `tasks` api's patterns, the suite's control views outside its base path,
and the framework route of the unlisted and allow-listed boot variants."""

from typing import Final

from control import hook_calls, load_script, log_lines
from django.http import HttpRequest, JsonResponse
from django.urls import URLPattern, URLResolver, include, path
from seampact_consumer_suite.boot_variant import serves_unlisted_route
from seampact_consumer_suite.control_routes import HOOK_CALLS_PATH, LOG_LINES_PATH, SCRIPT_PATH

UNLISTED_PATH: Final = "v1/unlisted"


def _unlisted(request: HttpRequest) -> JsonResponse:
    return JsonResponse({"route": "unlisted"})


urlpatterns: list[URLPattern | URLResolver] = [
    path("", include("generated.tasks.urls")),
    path(SCRIPT_PATH.removeprefix("/"), load_script),
    path(HOOK_CALLS_PATH.removeprefix("/"), hook_calls),
    path(LOG_LINES_PATH.removeprefix("/"), log_lines),
]

if serves_unlisted_route():
    urlpatterns.append(path(UNLISTED_PATH, _unlisted))
