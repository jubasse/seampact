"""The Django settings of the DRF consumer: the boundaries of the reference contract's apis first in MIDDLEWARE, their
handlers, hook doubles, idempotency store and the DRF token authentication of the `identity` access kind in SEAMPACT,
less what the boot variant (`SEAMPACT_SUITE_BOOT_VARIANT`) leaves out, and DRF defaults that refuse every request."""

import logging
from pathlib import Path
from typing import Final

from seampact_consumer_suite.boot_variant import (
    BootVariant,
    current_boot_variant,
    leaves_out_authenticate_hook,
    leaves_out_health_handler,
)
from seampact_consumer_suite.log_lines import SuiteLogHandler
from seampact_consumer_suite.suite_files import SuiteFiles, configure_suite_files

APP_DIRECTORY: Final = Path(__file__).parent
CONTROL_STATE_FILE: Final = "suite-control.json"
CREDENTIALS_FILE: Final = "credentials.json"
USER_IDENTITY: Final = "user"
STRIPE_IDENTITY: Final = "stripe"
SERVICE_IDENTITY: Final = "service"
DEVICE_IDENTITY: Final = "device"
CHANNEL_SCOPE: Final = "channel"
OVERRIDDEN_RIGHT: Final = "tasks.update"
# The right the `missing-decider` boot variant leaves without a decider, as the suite's case names it.
MISSING_DECIDER_RIGHT: Final = "roles"
# Every right and rule of the `tasks` api reaches the generic decider, but the overridden one.
TASKS_DECIDED: Final = ("tasks.read", "tasks.seeEffort", "recentAuth", "roles", "throttle")
SERVICE_DECIDED: Final = ("callerService",)
# The origin the tasksAbsoluteUrls api writes its absolute URLs from, never the request's Host.
PUBLIC_ORIGIN: Final = "https://api.seampact.test"
# The consumer's DRF token authentication, which signs in the `user` hook's caller.
_SUITE_TOKEN_AUTHENTICATION: Final = {"authentication_classes": ["drf_auth.SuiteTokenAuthentication"]}

configure_suite_files(SuiteFiles(str(APP_DIRECTORY / CONTROL_STATE_FILE), str(APP_DIRECTORY / CREDENTIALS_FILE)))
logging.getLogger().addHandler(SuiteLogHandler())
logging.getLogger().setLevel(logging.INFO)

_variant = current_boot_variant()

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
INSTALLED_APPS = ["django.contrib.contenttypes", "django.contrib.auth", "rest_framework", "seampact.django"]
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

# DRF defaults that would refuse every request: they never apply to a contract route.
REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAdminUser"],
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"anon": "1/day"},
}

_handlers = {
    "app": "health_handlers.app_handlers",
    "channels": "handlers.channels_handlers",
    "drafts": "handlers.drafts_handlers",
    "hooks": "handlers.hooks_handlers",
    "preferences": "handlers.preferences_handlers",
    "tasks": "handlers.tasks_handlers",
}
_authenticate = {USER_IDENTITY: "hooks.user_hook", STRIPE_IDENTITY: "hooks.stripe_hook"}
_deciders = {name: "hooks.tasks_decider" for name in TASKS_DECIDED} | {OVERRIDDEN_RIGHT: "hooks.overridden_right_decider"}

if leaves_out_health_handler():
    del _handlers["app"]

if leaves_out_authenticate_hook():
    del _authenticate[USER_IDENTITY]

if _variant is BootVariant.MISSING_DECIDER:
    del _deciders[MISSING_DECIDER_RIGHT]

SEAMPACT = {
    "tasks": {
        "handlers": _handlers,
        "authenticate": _authenticate,
        "deciders": _deciders,
        "scope_resolvers": (
            {} if _variant is BootVariant.MISSING_SCOPE_RESOLVER else {CHANNEL_SCOPE: "hooks.channel_resolver"}
        ),
        "idempotency_store": "hooks.idempotency_store",
        "on_unexpected_error": "hooks.unexpected_errors",
        "access": {"identity": _SUITE_TOKEN_AUTHENTICATION},
    },
    "tasksService": {
        "handlers": {"internal": "handlers.internal_handlers"},
        "authenticate": {SERVICE_IDENTITY: "hooks.service_hook"},
        "deciders": {name: "hooks.service_decider" for name in SERVICE_DECIDED},
        "on_unexpected_error": "hooks.unexpected_errors",
    },
    "tasksServiceWrites": {
        "handlers": {"internal_writes": "handlers.internal_writes_handlers"},
        "authenticate": {SERVICE_IDENTITY: "hooks.service_hook"},
        "deciders": {name: "hooks.service_decider" for name in SERVICE_DECIDED},
        "idempotency_store": "hooks.idempotency_store",
        "on_unexpected_error": "hooks.unexpected_errors",
    },
    "tasksDevices": {
        "handlers": {"devices": "handlers.devices_handlers"},
        "authenticate": {DEVICE_IDENTITY: "hooks.device_hook"},
        "on_unexpected_error": "hooks.unexpected_errors",
    },
    "tasksOptionalAuth": {
        "handlers": {"welcome": "handlers.welcome_handlers"},
        "authenticate": {USER_IDENTITY: "hooks.user_hook"},
        "on_unexpected_error": "hooks.unexpected_errors",
        "access": {"optional": _SUITE_TOKEN_AUTHENTICATION},
    },
    "tasksAbsoluteUrls": {
        "handlers": {"notes": "handlers.notes_handlers"},
        "authenticate": {USER_IDENTITY: "hooks.user_hook"},
        "on_unexpected_error": "hooks.unexpected_errors",
        "public_origin": PUBLIC_ORIGIN,
        "access": {"identity": _SUITE_TOKEN_AUTHENTICATION},
    },
    "tasksPaging": {
        "handlers": {
            "notes": "paging_factories.paging_notes_handlers",
            "capped": "paging_factories.paging_capped_handlers",
        },
        "authenticate": {USER_IDENTITY: "paging_factories.paging_user_hook"},
        "on_unexpected_error": "paging_factories.paging_unexpected_errors",
    },
    "tasksSplitSort": {
        "handlers": {"notes": "paging_factories.split_sort_notes_handlers"},
        "authenticate": {USER_IDENTITY: "paging_factories.paging_user_hook"},
        "on_unexpected_error": "paging_factories.paging_unexpected_errors",
    },
}
