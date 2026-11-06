"""The consumer's NinjaAPI: the `tasks` api bound with the shared handlers, the hook doubles and Ninja's own bearer
authentication for the `identity` access kind, less what the boot variant (`SEAMPACT_SUITE_BOOT_VARIANT`) leaves out,
and the other apis of the reference contract beside it. The app-wide `auth=` would refuse every request: it never
reaches a contract route."""

from typing import Final

import hooks
from auth import suite_token_auth
from django.http import HttpRequest
from generated.tasks.ninja import TasksHandlerFactories, bind_tasks
from generated.tasks_absolute_urls.ninja import TasksAbsoluteUrlsHandlerFactories, bind_tasks_absolute_urls
from generated.tasks_devices.ninja import TasksDevicesHandlerFactories, bind_tasks_devices
from generated.tasks_optional_auth.ninja import TasksOptionalAuthHandlerFactories, bind_tasks_optional_auth
from generated.tasks_service.ninja import TasksServiceHandlerFactories, bind_tasks_service
from generated.tasks_service_writes.ninja import TasksServiceWritesHandlerFactories, bind_tasks_service_writes
from handler_factories import (
    channels_handlers,
    devices_handlers,
    drafts_handlers,
    hooks_handlers,
    internal_handlers,
    internal_writes_handlers,
    notes_handlers,
    preferences_handlers,
    tasks_handlers,
    welcome_handlers,
)
from hook_doubles import CALLER_SERVICE_RIGHT, OVERRIDDEN_RIGHT
from ninja import NinjaAPI
from seampact_consumer_suite.boot_variant import (
    MISMATCHED_MOUNT,
    BootVariant,
    current_boot_variant,
    leaves_out_authenticate_hook,
    leaves_out_health_handler,
    mounts_under_mismatched_prefix,
)

import seampact.ninja.runtime as seampact_ninja

USER_IDENTITY: Final = "user"
STRIPE_IDENTITY: Final = "stripe"
SERVICE_IDENTITY: Final = "service"
DEVICE_IDENTITY: Final = "device"
CHANNEL_SCOPE: Final = "channel"
IDENTITY_ACCESS: Final = "identity"
# The origin the tasksAbsoluteUrls api writes its absolute URLs from, never the request's Host.
PUBLIC_ORIGIN: Final = "https://api.seampact.test"
# Every right and rule the tasks api's operations ask a decider for.
DECIDED_NAMES: Final = ("tasks.read", "tasks.update", "tasks.seeEffort", "roles", "throttle", "recentAuth")
# The right the `missing-decider` boot variant leaves without a decider, as the suite's case names it.
MISSING_DECIDER_RIGHT: Final = "roles"


def _refuse_everyone(request: HttpRequest) -> None:
    return None


def _deciders(variant: BootVariant | None) -> dict[str, seampact_ninja.Factory[object]]:
    deciders: dict[str, seampact_ninja.Factory[object]] = {
        name: hooks.overridden_right_decider if name == OVERRIDDEN_RIGHT else hooks.tasks_decider
        for name in DECIDED_NAMES
    }

    if variant is BootVariant.MISSING_DECIDER:
        del deciders[MISSING_DECIDER_RIGHT]

    return deciders


def _scope_resolvers(variant: BootVariant | None) -> dict[str, seampact_ninja.Factory[object]]:
    return {} if variant is BootVariant.MISSING_SCOPE_RESOLVER else {CHANNEL_SCOPE: hooks.channel_resolver}


def _handler_factories(variant: BootVariant | None) -> TasksHandlerFactories:
    groups: dict[str, object] = {
        "channels": channels_handlers,
        "drafts": drafts_handlers,
        "hooks": hooks_handlers,
        "preferences": preferences_handlers,
        "tasks": tasks_handlers,
    }

    # The app built with `health` filtered out generates no `app` group and has no `health_handler_factories` module.
    if variant is BootVariant.MISSING_HANDLER:
        groups["app"] = None
    elif not leaves_out_health_handler():
        from health_handler_factories import app_handlers

        groups["app"] = app_handlers

    return TasksHandlerFactories(**groups)


def create_api() -> NinjaAPI:
    variant = current_boot_variant()
    api = NinjaAPI(urls_namespace="consumer", auth=_refuse_everyone)
    authenticate: dict[str, seampact_ninja.Factory[object]] = {STRIPE_IDENTITY: hooks.stripe_hook}

    if not leaves_out_authenticate_hook():
        authenticate[USER_IDENTITY] = hooks.user_hook

    # The mount-mismatch variant serves the tasks api under a router prefix its entry's mount does not state.
    bind_tasks(
        api,
        prefix=MISMATCHED_MOUNT if mounts_under_mismatched_prefix() else "",
        handlers=_handler_factories(variant),
        authenticate=authenticate,
        deciders=_deciders(variant),
        scope_resolvers=_scope_resolvers(variant),
        idempotency_store=hooks.idempotency_store,
        on_unexpected_error=hooks.unexpected_errors,
        access={IDENTITY_ACCESS: seampact_ninja.AccessSettings(auth=suite_token_auth)},
    )
    bind_tasks_service(
        api,
        prefix="",
        handlers=TasksServiceHandlerFactories(internal=internal_handlers),
        authenticate={SERVICE_IDENTITY: hooks.service_hook},
        deciders={CALLER_SERVICE_RIGHT: hooks.service_decider},
        on_unexpected_error=hooks.unexpected_errors,
    )
    _bind_security_apis(api)

    return api


def _bind_security_apis(api: NinjaAPI) -> None:
    """The apis of the security cases: service writes, a device identity, optional auth and absolute URLs."""
    bind_tasks_service_writes(
        api,
        prefix="",
        handlers=TasksServiceWritesHandlerFactories(internal_writes=internal_writes_handlers),
        authenticate={SERVICE_IDENTITY: hooks.service_hook},
        deciders={CALLER_SERVICE_RIGHT: hooks.service_decider},
        idempotency_store=hooks.idempotency_store,
        on_unexpected_error=hooks.unexpected_errors,
    )
    bind_tasks_devices(
        api,
        prefix="",
        handlers=TasksDevicesHandlerFactories(devices=devices_handlers),
        authenticate={DEVICE_IDENTITY: hooks.device_hook},
        on_unexpected_error=hooks.unexpected_errors,
    )
    bind_tasks_optional_auth(
        api,
        prefix="",
        handlers=TasksOptionalAuthHandlerFactories(welcome=welcome_handlers),
        authenticate={USER_IDENTITY: hooks.optional_user_hook},
        on_unexpected_error=hooks.unexpected_errors,
    )
    bind_tasks_absolute_urls(
        api,
        prefix="",
        handlers=TasksAbsoluteUrlsHandlerFactories(notes=notes_handlers),
        authenticate={USER_IDENTITY: hooks.user_hook},
        on_unexpected_error=hooks.unexpected_errors,
        access={IDENTITY_ACCESS: seampact_ninja.AccessSettings(auth=suite_token_auth)},
        public_origin=PUBLIC_ORIGIN,
    )


api = create_api()
