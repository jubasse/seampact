"""The `seampact.django` app, which an app lists in `INSTALLED_APPS` beside the generated boundaries (ADR 0027
"Distributions")."""

from typing import Final

from django.apps import AppConfig

APP_LABEL: Final = "seampact_django"


class SeampactDjangoConfig(AppConfig):
    name = "seampact.django"
    label = APP_LABEL
    verbose_name = "seampact"
