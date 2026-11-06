"""The factory of the `tasks` api's `health` handlers, in a module of its own: the app built with `health` filtered out
has no `health` types to import, so `assemble.sh` leaves this module and `health_handlers.py` out of it."""

from django.http import HttpRequest
from health_handlers import AppHandlers


def app_handlers(request: HttpRequest) -> AppHandlers:
    return AppHandlers()
