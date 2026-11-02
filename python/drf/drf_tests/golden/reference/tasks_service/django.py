"""The Django boundary of api 'tasksService': list TasksServiceBoundary first in MIDDLEWARE."""

import seampact.django.runtime as _django_runtime

from . import contract as _contract
from . import settings as _settings


class TasksServiceBoundary(_django_runtime.ContractBoundary):
    """The boundary middleware of api 'tasksService'."""

    api = "tasksService"
    generated_by = "0.0.0-dev"
    contract = _contract.CONTRACT
    settings_keys = _settings.SETTINGS_KEYS
    handler_resources = ("internal",)
    responses = "strict"
    body_validation = False
    framework_etag = "strip"
    catch_all = True
    boot_check = True
    boot_check_framework_routes = True
    boot_check_hooks = True
    frameworks = ()
    framework_routes = ()
