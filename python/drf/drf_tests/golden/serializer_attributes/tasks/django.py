"""The Django boundary of api 'tasks': list TasksBoundary first in MIDDLEWARE."""

import seampact.django.runtime as _django_runtime

from . import contract as _contract
from . import settings as _settings


class TasksBoundary(_django_runtime.ContractBoundary):
    """The boundary middleware of api 'tasks'."""

    api = "tasks"
    generated_by = "0.0.0-dev"
    contract = _contract.CONTRACT
    settings_keys = _settings.SETTINGS_KEYS
    handler_resources = ("tasks",)
    responses = "strict"
    body_validation = False
    framework_etag = "strip"
    catch_all = True
    boot_check = True
    boot_check_framework_routes = True
    boot_check_hooks = True
    frameworks = ()
    framework_routes = ()
