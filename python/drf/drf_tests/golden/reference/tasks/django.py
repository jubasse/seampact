"""The Django boundary of api 'tasks': list TasksBoundary first in MIDDLEWARE."""

import collections.abc as _abc
import typing as _typing

import seampact.drf.runtime as _drf_runtime

from . import contract as _contract
from . import settings as _settings


class TasksBoundary(_drf_runtime.DrfContractBoundary):
    """The boundary middleware of api 'tasks'."""

    api = "tasks"
    generated_by = "0.0.0-dev"
    contract = _contract.CONTRACT
    settings_keys = _settings.SETTINGS_KEYS
    handler_resources: _typing.ClassVar[_abc.Mapping[str, _abc.Sequence[str]]] = {
        "tasks": (
            "archiveTask",
            "assignTask",
            "createTask",
            "getTask",
            "getTasksBatch",
            "listTasks",
            "purgeTask",
            "searchTasks",
            "updateTask",
        ),
        "drafts": ("deleteDraft", "getDraft"),
        "channels": ("getChannel", "listChannels"),
        "preferences": ("getPreferences", "updatePreferences"),
        "app": ("health",),
        "hooks": ("payments",),
    }
    responses = "strict"
    body_validation = False
    framework_etag = "strip"
    catch_all = True
    boot_check = True
    boot_check_framework_routes = True
    boot_check_hooks = True
    frameworks = ()
    framework_routes = ()
