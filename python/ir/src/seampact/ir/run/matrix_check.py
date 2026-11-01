"""The compatibility check of the Python entries (ADR 0011 "The app config", ADR 0009), as the Node CLI and the JVM
plugins run it and with their codes: the framework version pip installed is checked against the `pythonTargets` of the
matrix. A target the matrix does not record is not checked."""

from collections.abc import Mapping

from seampact.ir.config.app_config import AppConfig, AppConfigEntry
from seampact.ir.config.json_value import string_of, strings_of
from seampact.ir.config.problem import ConfigProblem
from seampact.ir.run.discovery import normalized_name
from seampact.ir.run.matrix_framework import MatrixFramework, MatrixTarget, parse_version, python_targets

_ERROR_LEVEL = "error"


def check_matrix(
    config: AppConfig, installed: Mapping[str, str], targets: Mapping[str, MatrixTarget] | None = None
) -> tuple[list[ConfigProblem], list[ConfigProblem]]:
    """`installed` maps the normalised name of each installed distribution to its version. Returns the problems that
    refuse the run, and the warnings."""
    recorded = python_targets() if targets is None else targets
    untested_is_error = string_of(config.checks, "matrix") == _ERROR_LEVEL
    problems: list[ConfigProblem] = []
    warnings: list[ConfigProblem] = []

    for entry in config.entries:
        target = recorded.get(entry.use)

        if target is None:
            continue

        allowed = strings_of(entry.entry, "allowUntested") or []

        for item in allowed:
            framework = _framework_named(target, _framework_id_of(item))

            if framework is None:
                problems.append(_foreign_framework(entry, item, target))
            elif item in framework.tested_items():
                warnings.append(_allowed_tested(entry, item))

        for framework in target.frameworks:
            outcome = _version_outcome(entry, framework, installed.get(normalized_name(framework.package)), allowed)

            if outcome is None:
                continue

            if outcome.code == "config.matrix.untested" and not untested_is_error:
                warnings.append(outcome)
            else:
                problems.append(outcome)

    return problems, warnings


def _version_outcome(
    entry: AppConfigEntry, framework: MatrixFramework, version: str | None, allowed: list[str]
) -> ConfigProblem | None:
    where = _where(entry)

    if version is None:
        return ConfigProblem(
            "framework.version.unresolved",
            f"pip has not installed {framework.package}, the framework the target '{entry.use}' generates for, so its "
            "version cannot be checked.",
            f"Install {framework.package} in the app, {framework.id} {framework.tested_text}, then run seampact again.",
            where,
        )

    parts = parse_version(version)

    if parts is None:
        return ConfigProblem(
            "framework.version.unresolved",
            f"pip installed {framework.package} '{version}', a version whose major and minor the compatibility check "
            "cannot read.",
            f"Install a released {framework.package} version, {framework.id} {framework.tested_text}.",
            where,
        )

    major, minor = parts
    unit = framework.unit_of(major, minor)
    reason = framework.incompatible.get(unit)

    if reason is not None:
        return ConfigProblem(
            "config.matrix.incompatible",
            f"pip installed {framework.package} {version}, and the target '{entry.use}' does not work on "
            f"{framework.id} {unit}: {reason}",
            f"Use a version of {framework.package} the target is tested on: {framework.tested_text}.",
            where,
        )

    if framework.is_below_floor(major, minor):
        return ConfigProblem(
            "config.matrix.incompatible",
            f"pip installed {framework.package} {version}, and the target '{entry.use}' works on {framework.id} "
            f"{framework.floor} or later only.",
            f"Install {framework.package} {framework.floor} or later, {framework.id} {framework.tested_text}.",
            where,
        )

    allow_item = f"{framework.id}@{unit}"

    if unit in framework.tested or allow_item in allowed:
        return None

    return ConfigProblem(
        "config.matrix.untested",
        f"pip installed {framework.package} {version}, and the target '{entry.use}' is tested on {framework.id} "
        f"{framework.tested_text} only.",
        f"Use a tested version, or accept this one with `allowUntested: [{allow_item}]` on the entry.",
        where,
    )


def _framework_named(target: MatrixTarget, framework_id: str) -> MatrixFramework | None:
    return next((framework for framework in target.frameworks if framework.id == framework_id), None)


def _framework_id_of(item: str) -> str:
    """`<framework>@<unit>`, as the app config schema checked it."""
    return item.rpartition("@")[0] if "@" in item else item


def _where(entry: AppConfigEntry) -> str:
    return f"entry '{entry.id}'"


def _foreign_framework(entry: AppConfigEntry, item: str, target: MatrixTarget) -> ConfigProblem:
    served = ", ".join(f"'{framework.id}'" for framework in target.frameworks)

    return ConfigProblem(
        "config.matrix.unknown-framework",
        f"The `allowUntested` item '{item}' names the framework '{_framework_id_of(item)}', and the target "
        f"'{entry.use}' serves {served}.",
        f"Write the item as '{target.frameworks[0].id}@<version>', or remove it.",
        f"{_where(entry)} allowUntested",
    )


def _allowed_tested(entry: AppConfigEntry, item: str) -> ConfigProblem:
    return ConfigProblem(
        "config.matrix.allowed-tested",
        f"The `allowUntested` item '{item}' names a version the compatibility matrix tests the target '{entry.use}' "
        "on, so it accepts nothing.",
        f"Remove '{item}' from the entry's `allowUntested`.",
        f"{_where(entry)} allowUntested",
    )
