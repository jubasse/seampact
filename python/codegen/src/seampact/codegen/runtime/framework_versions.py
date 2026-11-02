"""The framework versions `generate` accepted (ADR 0026 "The boot check"): the generated code records, per framework
the target serves or runs on, the units of the compatibility matrix (a major, or a `<major>.<minor>` for a 0.x
framework) plus the entry's `allowUntested` ones, and the boot check refuses an installed version outside them, so an
upgrade after `generate` fails the boot by name."""

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

    def unit_of(self, version: str) -> str | None:
        match = _VERSION.match(version)

        if match is None:
            return None

        return match.group(1) if self.unit is VersionUnit.MAJOR else f"{match.group(1)}.{match.group(2)}"


def framework_version_problems(frameworks: Sequence[AcceptedFramework], api: str) -> list[str]:
    return [problem for framework in frameworks if (problem := _version_problem(framework, api)) is not None]


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
