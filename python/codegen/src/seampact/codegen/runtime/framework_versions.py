"""The framework versions `generate` accepted (ADR 0026 "The boot check"): the generated code records, per framework
the target serves or runs on, the units of the compatibility matrix (a major, or a `<major>.<minor>` for a 0.x
framework) plus the entry's `allowUntested` ones, and the boot check refuses an installed version outside them, so an
upgrade after `generate` fails the boot by name. A framework checked by major may also record the matrix's tested
minors: an installed minor outside them, within a tested major, is only warned of (ADR 0027 section 1, The shared Django layer)."""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from importlib import metadata
from typing import Final

_VERSION: Final = re.compile(r"(\d+)\.(\d+)")


class VersionUnit(StrEnum):
    MAJOR = "major"
    MINOR = "minor"


@dataclass(frozen=True, slots=True, kw_only=True)
class AcceptedFramework:
    """A distribution (`fastapi`) and the units `generate` accepted for it, compared by `unit`."""

    package: str
    unit: VersionUnit
    accepted: tuple[str, ...]
    tested_minors: tuple[str, ...] = ()

    def unit_of(self, version: str) -> str | None:
        match = _VERSION.match(version)

        if match is None:
            return None

        return match.group(1) if self.unit is VersionUnit.MAJOR else f"{match.group(1)}.{match.group(2)}"


def framework_version_problems(frameworks: Sequence[AcceptedFramework], api: str) -> list[str]:
    return [problem for framework in frameworks if (problem := _version_problem(framework, api)) is not None]


def framework_version_warnings(frameworks: Sequence[AcceptedFramework], api: str) -> list[str]:
    """One line per installed framework whose minor is outside the tested minors of its major."""
    return [warning for framework in frameworks if (warning := _untested_minor(framework, api)) is not None]


def _untested_minor(framework: AcceptedFramework, api: str) -> str | None:
    if not framework.tested_minors:
        return None

    try:
        installed = metadata.version(framework.package)
    except metadata.PackageNotFoundError:
        return None

    match = _VERSION.match(installed)
    tested_majors = {minor.partition(".")[0] for minor in framework.tested_minors}

    if match is None or match.group(1) not in tested_majors:
        return None

    if f"{match.group(1)}.{match.group(2)}" in framework.tested_minors:
        return None

    tested = ", ".join(framework.tested_minors)

    return (
        f"{framework.package} {installed} is installed, and the api '{api}' is tested on {framework.package} "
        f"{tested} only, so this minor is untested; install a tested minor to serve on a tested version"
    )


def _version_problem(framework: AcceptedFramework, api: str) -> str | None:
    try:
        installed = metadata.version(framework.package)
    except metadata.PackageNotFoundError:
        return f"{framework.package} is not installed; the api '{api}' was generated for {_units(framework)}"

    if framework.unit_of(installed) in framework.accepted:
        return None

    return (
        f"{framework.package} {installed} is installed, but the api '{api}' was generated for {_units(framework)}; "
        f"install one of those, or run seampact generate again (with `allowUntested` for an untested {framework.unit})"
    )


def _units(framework: AcceptedFramework) -> str:
    return ", ".join(f"{framework.package} {unit}" for unit in framework.accepted)
