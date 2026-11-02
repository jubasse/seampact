"""The Django boundary of api 'tasks': list TasksBoundary first in MIDDLEWARE."""

import seampact.django.runtime as _django_runtime

from . import contract as _contract


class TasksBoundary(_django_runtime.ContractBoundary):
    """The boundary middleware of api 'tasks'."""

    api = "tasks"
    generated_by = "0.0.0-dev"
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
    )
    framework_routes = ()
