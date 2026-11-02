"""The Django runtime of `seampact-django` that needs no generated api: the app config Django loads with its system
check, and the handler factories read from `settings.SEAMPACT`. The boundary itself is tested end to end against
the reference contract's generated DRF package, in `seampact-drf`'s tests."""

import django
import pytest
from django.apps import apps
from django.conf import settings
from django.test import RequestFactory, override_settings

from seampact.django.apps import APP_LABEL
from seampact.django.runtime import built_handlers
from seampact.django.runtime.api_settings import SettingsError

if not settings.configured:
    settings.configure(INSTALLED_APPS=["seampact.django"])
    django.setup()


def tasks_endpoints(request: object) -> str:
    return "built"


def test_django_loads_the_seampact_app_by_its_module() -> None:
    assert apps.get_app_config(APP_LABEL).name == "seampact.django"


def test_a_handler_factory_is_called_with_the_request() -> None:
    with override_settings(SEAMPACT={"tasks": {"handlers": {"tasks": f"{__name__}.tasks_endpoints"}}}):
        assert built_handlers("tasks", "tasks", RequestFactory().get("/v1/tasks")) == "built"


def test_a_factory_that_does_not_import_is_refused_naming_the_setting() -> None:
    with (
        override_settings(SEAMPACT={"tasks": {"handlers": {"tasks": "app.missing.factory"}}}),
        pytest.raises(SettingsError, match=r"\['handlers'\]\['tasks'\] names 'app.missing.factory'"),
    ):
        built_handlers("tasks", "tasks", RequestFactory().get("/v1/tasks"))
