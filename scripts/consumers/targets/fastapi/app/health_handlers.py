"""The developer's handlers of the `tasks` api's `health` operation, in a module of their own: the app built with
`health` filtered out has no `health` types to import, so `assemble.sh` leaves this module out of it."""

from generated.tasks.operations import HealthRequest, HealthResponse200, HealthResult
from generated.tasks.schemas import Health
from seampact_consumer_suite.scripted_answers import scripted_answer, text_member

_OK: int = 200
_HEALTHY: str = "ok"


def _health_of(body: dict[str, object]) -> HealthResult:
    return HealthResponse200(Health(status=text_member(body, "status")))


class AppHandlers:
    def health(self, request: HealthRequest) -> HealthResult:
        return scripted_answer("health", _OK, _health_of) or HealthResponse200(Health(status=_HEALTHY))
