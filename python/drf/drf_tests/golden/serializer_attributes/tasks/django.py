"""The Django boundary of api 'tasks': list TasksBoundary first in MIDDLEWARE."""

import seampact.django.runtime as _django_runtime


class TasksBoundary(_django_runtime.ContractBoundary):
    """The boundary middleware of api 'tasks'."""

    api = "tasks"
    generated_by = "0.0.0-dev"
    responses = "strict"
    body_validation = False
    framework_etag = "strip"
    catch_all = True
    boot_check = True
    boot_check_framework_routes = True
    boot_check_hooks = True
