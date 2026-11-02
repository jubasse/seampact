"""The `frameworkDocs` switch of a Python target entry (ADR 0011 "Which OpenAPI documents exist"), as the Node CLI
reads it: `keep` leaves the framework's own document as the framework has it; `off` is refused by name on a target
that cannot switch that document off, with the fix the target states."""

from typing import Final

from seampact.ir.config.app_config import AppConfigEntry
from seampact.ir.config.json_value import string_of
from seampact.ir.config.problem import ConfigProblem
from seampact.ir.run.generator import Generator

_OFF: Final = "off"


def framework_docs_problems(entry: AppConfigEntry, generator: Generator) -> list[ConfigProblem]:
    if string_of(entry.entry, "frameworkDocs") != _OFF:
        return []

    fix = generator.framework_docs_off_fix()

    if fix is None:
        return []

    return [
        ConfigProblem(
            "config.frameworkDocs.unsupported",
            f"The target '{entry.use}' cannot switch its framework's own OpenAPI document off.",
            fix,
            f"entry '{entry.id}'",
        )
    ]
