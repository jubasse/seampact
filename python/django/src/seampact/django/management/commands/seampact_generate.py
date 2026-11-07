"""`python manage.py seampact_generate`: runs `seampact generate` from the project root (ADR 0026's runner). It
declares no system check, so the command that fixes a version mismatch still runs."""

import os
import sys
from importlib import import_module

from django.core.management.base import BaseCommand, CommandError, CommandParser

_RUNNER_MODULE = "seampact.ir.run.command"
_GENERATE = "generate"


class Command(BaseCommand):
    help = "Generates the seampact code of every api, as `seampact generate` does."
    requires_system_checks = ()

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("arguments", nargs="*", help="Arguments passed on to `seampact generate`.")

    def handle(self, *args: object, **options: object) -> None:
        try:
            runner = import_module(_RUNNER_MODULE)
        except ImportError as missing:
            raise CommandError(
                f"seampact: the generator is not installed ({missing}); install seampact-django[generate]."
            ) from missing

        passed = options.get("arguments")
        arguments = [_GENERATE, *(str(argument) for argument in passed)] if isinstance(passed, list) else [_GENERATE]
        status = runner.run(arguments, os.getcwd(), dict(os.environ), sys.stdout, sys.stderr)

        if status != 0:
            raise CommandError(f"seampact generate exited with status {status}.")
