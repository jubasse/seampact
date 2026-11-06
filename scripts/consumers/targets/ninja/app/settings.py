"""The Django settings of the Django Ninja consumer: the `tasks` and `tasksService` apis' boundaries first in
MIDDLEWARE, and no SEAMPACT entry, since the `bind_*()` functions in `api.py` hand the runtime their
values."""

import logging
from pathlib import Path
from typing import Final

from seampact_consumer_suite.log_lines import SuiteLogHandler
from seampact_consumer_suite.suite_files import SuiteFiles, configure_suite_files

APP_DIRECTORY: Final = Path(__file__).parent
CONTROL_STATE_FILE: Final = "suite-control.json"
CREDENTIALS_FILE: Final = "credentials.json"

configure_suite_files(SuiteFiles(str(APP_DIRECTORY / CONTROL_STATE_FILE), str(APP_DIRECTORY / CREDENTIALS_FILE)))
logging.getLogger().addHandler(SuiteLogHandler())
logging.getLogger().setLevel(logging.INFO)

# A throwaway key: the consumer signs nothing and keeps no session.
SECRET_KEY = "seampact-consumer-suite"
DEBUG = False
# The absolute-URLs case's forged Host is accepted, so the case proves the boundary writes its links from the
# public origin, never from a Host the app accepts.
FORGED_HOST: Final = "attacker.example"
ALLOWED_HOSTS = ["127.0.0.1", "localhost", FORGED_HOST]
ROOT_URLCONF = "urls"
USE_TZ = True
DATABASES: dict[str, object] = {}
INSTALLED_APPS = ["ninja", "seampact.django"]
MIDDLEWARE = [
    "generated.tasks.django.TasksBoundary",
    "generated.tasks_service.django.TasksServiceBoundary",
    "generated.tasks_service_writes.django.TasksServiceWritesBoundary",
    "generated.tasks_devices.django.TasksDevicesBoundary",
    "generated.tasks_optional_auth.django.TasksOptionalAuthBoundary",
    "generated.tasks_absolute_urls.django.TasksAbsoluteUrlsBoundary",
    "generated.tasks_paging.django.TasksPagingBoundary",
    "generated.tasks_split_sort.django.TasksSplitSortBoundary",
    "django.middleware.common.CommonMiddleware",
]
