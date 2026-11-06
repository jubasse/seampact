"""The root URLconf of the DRF consumer: the patterns of the reference contract's apis, the suite's control views
outside its base path, and the framework routes of the boot variants: the unlisted route, the patterned route, and the
`tasks` api's patterns included under a prefix its entry's mount does not state."""

from typing import Final

from control import hook_calls, load_script, log_lines
from django.http import HttpRequest, JsonResponse
from django.urls import URLPattern, URLResolver, include, path
from seampact_consumer_suite.boot_variant import (
    MISMATCHED_MOUNT,
    PATTERNED_ROUTE,
    mounts_under_mismatched_prefix,
    serves_patterned_route,
    serves_unlisted_route,
)
from seampact_consumer_suite.control_routes import HOOK_CALLS_PATH, LOG_LINES_PATH, SCRIPT_PATH

UNLISTED_PATH: Final = "v1/unlisted"
TASKS_PREFIX: Final = f"{MISMATCHED_MOUNT.removeprefix('/')}/" if mounts_under_mismatched_prefix() else ""


def _unlisted(request: HttpRequest) -> JsonResponse:
    return JsonResponse({"route": "unlisted"})


urlpatterns: list[URLPattern | URLResolver] = [
    path(TASKS_PREFIX, include("generated.tasks.urls")),
    path("", include("generated.tasks_service.urls")),
    path("", include("generated.tasks_service_writes.urls")),
    path("", include("generated.tasks_devices.urls")),
    path("", include("generated.tasks_optional_auth.urls")),
    path("", include("generated.tasks_absolute_urls.urls")),
    path("", include("generated.tasks_responses.urls")),
    path(SCRIPT_PATH.removeprefix("/"), load_script),
    path(HOOK_CALLS_PATH.removeprefix("/"), hook_calls),
    path(LOG_LINES_PATH.removeprefix("/"), log_lines),
]

if serves_unlisted_route():
    urlpatterns.append(path(UNLISTED_PATH, _unlisted))

if serves_patterned_route():
    urlpatterns.append(path(PATTERNED_ROUTE.removeprefix("/"), _unlisted))
