"""The Django boundary of api 'tasksService': list TasksServiceBoundary first in MIDDLEWARE."""

import collections.abc as _abc
import typing as _typing

import seampact.django.runtime as _django_runtime
import seampact.drf.runtime as _drf_runtime

from . import contract as _contract
from . import settings as _settings


class TasksServiceBoundary(_drf_runtime.DrfContractBoundary):
    """The boundary middleware of api 'tasksService'."""

    api = "tasksService"
    generated_by = "1.0.1"
    contract = _contract.CONTRACT
    settings_keys = _settings.SETTINGS_KEYS
    handler_resources: _typing.ClassVar[_abc.Mapping[str, _abc.Sequence[str]]] = {
        "internal": ("getTask",),
    }
    responses = "strict"
    body_validation = False
    framework_etag = "strip"
    catch_all = True
    boot_check = True
    boot_check_framework_routes = True
    boot_check_hooks = True
    frameworks = (
        _django_runtime.AcceptedFramework(
            package="djangorestframework",
            unit=_django_runtime.VersionUnit.MAJOR,
            accepted=("3",),
            tested_minors=("3.18",),
        ),
        _django_runtime.AcceptedFramework(
            package="django", unit=_django_runtime.VersionUnit.MAJOR, accepted=("5", "6"), tested_minors=("5.2", "6.1")
        ),
    )
    framework_routes = ()
