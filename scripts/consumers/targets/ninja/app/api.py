"""The consumer's NinjaAPI: the `tasks` api bound with the shared handlers, the hook doubles and Ninja's own bearer
authentication for the `identity` access kind, less what the boot variant (`SEAMPACT_SUITE_BOOT_VARIANT`) leaves out,
and the `tasksService` api beside it. The app-wide `auth=` would refuse every request: it never reaches a contract
route."""

from typing import Final

import hooks
from auth import suite_token_auth
from django.http import HttpRequest
from generated.tasks.ninja import TasksHandlerFactories, bind_tasks
from generated.tasks_service.ninja import TasksServiceHandlerFactories, bind_tasks_service
from handler_factories import (
    app_handlers,
    channels_handlers,
    drafts_handlers,
    hooks_handlers,
    internal_handlers,
    preferences_handlers,
    tasks_handlers,
)
from hook_doubles import CALLER_SERVICE_RIGHT, OVERRIDDEN_RIGHT
from ninja import NinjaAPI
from seampact_consumer_suite.boot_variant import BootVariant, current_boot_variant

import seampact.ninja.runtime as seampact_ninja

USER_IDENTITY: Final = "user"
STRIPE_IDENTITY: Final = "stripe"
SERVICE_IDENTITY: Final = "service"
CHANNEL_SCOPE: Final = "channel"
IDENTITY_ACCESS: Final = "identity"
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


def create_api() -> NinjaAPI:
    variant = current_boot_variant()
    api = NinjaAPI(urls_namespace="consumer", auth=_refuse_everyone)
    authenticate: dict[str, seampact_ninja.Factory[object]] = {STRIPE_IDENTITY: hooks.stripe_hook}

    if variant is not BootVariant.MISSING_AUTHENTICATE_HOOK:
        authenticate[USER_IDENTITY] = hooks.user_hook

    bind_tasks(
        api,
        prefix="",
        handlers=TasksHandlerFactories(
            app=None if variant is BootVariant.MISSING_HANDLER else app_handlers,
            channels=channels_handlers,
            drafts=drafts_handlers,
            hooks=hooks_handlers,
            preferences=preferences_handlers,
            tasks=tasks_handlers,
        ),
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

    return api


api = create_api()
