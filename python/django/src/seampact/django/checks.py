"""The Django system check of the seampact apis (ADR 0027 "The system check and the boot check"): it runs on
`check`, `runserver`, `migrate` and `test`, and reports each problem of the boot check as a `Warning` whose id is
`seampact.<api>`, so a broken api never stops `migrate` or `shell`."""

from collections.abc import Sequence

from django.apps import AppConfig
from django.core.checks import CheckMessage, Warning

from seampact.django.runtime.boot_check import every_problem


def seampact_check(app_configs: Sequence[AppConfig] | None = None, **kwargs: object) -> list[CheckMessage]:
    return [
        Warning(problem, hint="Run `python manage.py seampact_check` in CI.", id=f"seampact.{api}")
        for api, problem in every_problem()
    ]
