"""The Django settings of the DRF consumer: the `tasks` api's boundary first in MIDDLEWARE, its handlers and hook
doubles in SEAMPACT, less what the boot variant (`SEAMPACT_SUITE_BOOT_VARIANT`) leaves out."""

import logging
from pathlib import Path
from typing import Final

from seampact_consumer_suite.boot_variant import BootVariant, current_boot_variant
from seampact_consumer_suite.log_lines import SuiteLogHandler
from seampact_consumer_suite.suite_files import SuiteFiles, configure_suite_files

APP_DIRECTORY: Final = Path(__file__).parent
CONTROL_STATE_FILE: Final = "suite-control.json"
CREDENTIALS_FILE: Final = "credentials.json"
USER_IDENTITY: Final = "user"
CHANNEL_SCOPE: Final = "channel"

configure_suite_files(SuiteFiles(str(APP_DIRECTORY / CONTROL_STATE_FILE), str(APP_DIRECTORY / CREDENTIALS_FILE)))
logging.getLogger().addHandler(SuiteLogHandler())
logging.getLogger().setLevel(logging.INFO)

_variant = current_boot_variant()

# A throwaway key: the consumer signs nothing and keeps no session.
SECRET_KEY = "seampact-consumer-suite"
DEBUG = False
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
ROOT_URLCONF = "urls"
USE_TZ = True
DATABASES: dict[str, object] = {}
INSTALLED_APPS = ["django.contrib.contenttypes", "django.contrib.auth", "rest_framework", "seampact.django"]
MIDDLEWARE = ["generated.tasks.django.TasksBoundary", "django.middleware.common.CommonMiddleware"]

_handlers = {
    "app": "handlers.app_handlers",
    "channels": "handlers.channels_handlers",
    "drafts": "handlers.drafts_handlers",
}

if _variant is BootVariant.MISSING_HANDLER:
    del _handlers["app"]

SEAMPACT = {
    "tasks": {
        "handlers": _handlers,
        "authenticate": {} if _variant is BootVariant.MISSING_AUTHENTICATE_HOOK else {USER_IDENTITY: "hooks.user_hook"},
        "scope_resolvers": (
            {} if _variant is BootVariant.MISSING_SCOPE_RESOLVER else {CHANNEL_SCOPE: "hooks.channel_resolver"}
        ),
        "on_unexpected_error": "hooks.unexpected_errors",
    }
}
