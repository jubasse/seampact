"""The Django boundary of api 'tasksService': list TasksServiceBoundary first in MIDDLEWARE."""

import seampact.django.runtime as _django_runtime
import seampact.ninja.runtime as _ninja_runtime

from . import contract as _contract


class TasksServiceBoundary(_ninja_runtime.NinjaContractBoundary):
    """The boundary middleware of api 'tasksService'."""

    api = "tasksService"
    generated_by = "1.0.0"
    contract = _contract.CONTRACT
    responses = "strict"
    body_validation = False
    framework_etag = "strip"
    catch_all = True
    boot_check = True
    boot_check_framework_routes = True
    boot_check_hooks = True
    frameworks = (
        _django_runtime.AcceptedFramework(
            package="django-ninja",
            unit=_django_runtime.VersionUnit.MAJOR,
            accepted=("1",),
            tested_minors=("1.5", "1.7"),
        ),
        _django_runtime.AcceptedFramework(
            package="django", unit=_django_runtime.VersionUnit.MAJOR, accepted=("5", "6"), tested_minors=("5.2", "6.1")
        ),
        _django_runtime.AcceptedFramework(package="pydantic", unit=_django_runtime.VersionUnit.MAJOR, accepted=("2",)),
    )
    framework_routes = ()
