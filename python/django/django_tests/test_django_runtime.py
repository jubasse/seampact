"""The Django runtime of `seampact-django` before the boundary is delivered: the app config Django loads, and the
boundary middleware and the handler factories, which refuse by name rather than serve without the contract."""

import django
import pytest
from django.apps import apps
from django.conf import settings
from django.http import HttpRequest, HttpResponse
from django.test import RequestFactory

from seampact.django.apps import APP_LABEL
from seampact.django.runtime import PLACEMENT_UNAVAILABLE, ContractBoundary, PlacementUnavailableError, built_handlers

if not settings.configured:
    settings.configure(INSTALLED_APPS=["seampact.django"])
    django.setup()


class _TasksBoundary(ContractBoundary):
    api = "tasks"
    generated_by = "0.0.0-dev"


def _reply(request: HttpRequest) -> HttpResponse:
    return HttpResponse(request.method)


def test_django_loads_the_seampact_app_by_its_module() -> None:
    assert apps.get_app_config(APP_LABEL).name == "seampact.django"


def test_building_the_boundary_is_refused_by_name() -> None:
    with pytest.raises(PlacementUnavailableError, match=PLACEMENT_UNAVAILABLE) as refused:
        _TasksBoundary(_reply)

    assert "of api 'tasks'" in str(refused.value)


def test_building_handlers_is_refused_by_name() -> None:
    with pytest.raises(PlacementUnavailableError, match="resource 'tasks' of api 'tasks'"):
        built_handlers("tasks", "tasks", RequestFactory().get("/v1/tasks"))
