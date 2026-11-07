"""The developer's handlers of the `tasks` api's `health` operation and their factory, in a module of their own: the app
built with `health` filtered out has no `health` types to import, so `assemble.sh` leaves this module out of it."""

from django.http import HttpRequest
from generated.tasks import operations as tasks
from generated.tasks.schemas import Health
from seampact_consumer_suite.scripted_answers import scripted_answer, text_member

_OK: int = 200
_HEALTHY: str = "ok"


def _health_of(body: dict[str, object]) -> tasks.HealthResult:
    return tasks.HealthResponse200(body=Health(status=text_member(body, "status")))


class AppHandlers:
    def health(self, request: tasks.HealthRequest) -> tasks.HealthResult:
        return scripted_answer("health", _OK, _health_of) or tasks.HealthResponse200(body=Health(status=_HEALTHY))


def app_handlers(request: HttpRequest) -> AppHandlers:
    return AppHandlers()
