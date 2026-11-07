"""The `seampact.django` app, which an app lists in `INSTALLED_APPS` beside the generated boundaries (ADR 0027
"Distributions"); it registers the system check and carries the `seampact_check` and `seampact_generate`
commands."""

from typing import Final

from django.apps import AppConfig
from django.core.checks import register

APP_LABEL: Final = "seampact_django"


class SeampactDjangoConfig(AppConfig):
    name = "seampact.django"
    label = APP_LABEL
    verbose_name = "seampact"

    def ready(self) -> None:
        from seampact.django.checks import seampact_check

        register(seampact_check)
