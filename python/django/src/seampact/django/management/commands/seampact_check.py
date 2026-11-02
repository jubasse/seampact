"""`python manage.py seampact_check`, for CI: the boot check of every api, without starting a server; it exits
non-zero on any problem (ADR 0027 "The system check and the boot check")."""

from django.core.management.base import BaseCommand, CommandError

from seampact.django.runtime.boot_check import every_problem


class Command(BaseCommand):
    help = "Runs the seampact boot check of every api and fails on any problem."
    requires_system_checks = ()

    def handle(self, *args: object, **options: object) -> None:
        problems = every_problem()

        for api, problem in problems:
            self.stderr.write(f"seampact.{api}: {problem}")

        if problems:
            raise CommandError(f"seampact: {len(problems)} problem(s) stop the app from serving.")

        self.stdout.write("seampact: every api passes the boot check.")
