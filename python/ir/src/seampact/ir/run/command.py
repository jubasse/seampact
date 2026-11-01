"""The `seampact` command line: `generate [--config <file>] [--force]` and `check [--config <file>]`, run from the
project's root directory. Exit 0 passes, 1 is a refusal or a drift, 2 a usage error. Nothing runs on `pip install`."""

import os
import re
import sys
from collections.abc import Mapping, Sequence
from typing import Final, TextIO

from seampact.ir.config.problem import problems_text
from seampact.ir.run.runner import RunSettings, check, generate
from seampact.ir.write import HandEditPolicy

EXIT_PASSED: Final = 0
EXIT_REFUSED: Final = 1
EXIT_USAGE: Final = 2
_USAGE: Final = "Usage: seampact generate [--config <file>] [--force]\n       seampact check [--config <file>]\n"
_HELP_FLAGS: Final = ("-h", "--help")
_COMMANDS: Final = ("generate", "check")


def main() -> None:
    """The `seampact` console script."""
    raise SystemExit(run(sys.argv[1:], os.getcwd(), dict(os.environ), sys.stdout, sys.stderr))


def run(
    arguments: Sequence[str],
    project_directory: str,
    environment: Mapping[str, str],
    stdout: TextIO,
    stderr: TextIO,
) -> int:
    if arguments and arguments[0] in _HELP_FLAGS:
        stdout.write(_USAGE)

        return EXIT_PASSED

    parsed = _parsed(list(arguments))

    if isinstance(parsed, str):
        stderr.write(f"seampact: {parsed}\n{_USAGE}")

        return EXIT_USAGE

    command, config_file, force = parsed
    settings = RunSettings(
        project_directory, config_file or RunSettings.default_config_file(project_directory), environment
    )

    try:
        report = (
            generate(settings, HandEditPolicy.OVERWRITE if force else HandEditPolicy.REFUSE)
            if command == "generate"
            else check(settings)
        )
    except Exception as unexpected:
        stderr.write(_internal_error(unexpected))

        return EXIT_REFUSED

    for line in report.lines:
        stdout.write(f"{line}\n")

    for warning in report.warnings:
        stderr.write(f"seampact warning: {problems_text([warning])}\n")

    for line in report.compiler_warnings:
        stderr.write(f"seampact warning: {line}\n")

    if report.problems:
        stderr.write(problems_text(report.problems) + "\n")

        return EXIT_REFUSED

    return EXIT_PASSED


def _internal_error(unexpected: Exception) -> str:
    """On one line rather than a stack trace."""
    message = re.sub(r"\s+", " ", str(unexpected).strip())

    return f"seampact: internal error: {type(unexpected).__name__}: {message}\n"


def _parsed(arguments: list[str]) -> tuple[str, str | None, bool] | str:
    """The command, the config file and `--force`, or the usage error."""
    if not arguments:
        return "no command given."

    command = arguments.pop(0)

    if command not in _COMMANDS:
        return f"unknown command '{command}'."

    config_file: str | None = None
    force = False

    while arguments:
        argument = arguments.pop(0)

        if argument == "--force" and command == "generate":
            force = True
        elif argument == "--config" and arguments:
            config_file = arguments.pop(0)
        else:
            return f"unknown argument '{argument}' for {command}."

    return command, config_file, force
