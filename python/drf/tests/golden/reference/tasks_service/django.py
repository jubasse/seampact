"""The Django boundary of api 'tasksService': list TasksServiceBoundary first in MIDDLEWARE."""

import seampact.django.runtime as _django_runtime


class TasksServiceBoundary(_django_runtime.ContractBoundary):
    """The boundary middleware of api 'tasksService'."""

    api = "tasksService"
    generated_by = "0.0.0-dev"
    responses = "strict"
    body_validation = False
    framework_etag = "strip"
    catch_all = True
    boot_check = True
    boot_check_framework_routes = True
    boot_check_hooks = True
