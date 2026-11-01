"""A Python target's frameworks as the compatibility matrix records them (`compatibility/python-targets.json` of
`@seampact/spec`, of which `seampact.ir` ships a copy): per framework the unit it is checked by (its major, or its
`<major>.<minor>` for a 0.x framework, where a minor breaks), the units it is tested on, those it does not work on,
and the `floor`, the lowest `<major>.<minor>` it works on."""

import json
import re
from dataclasses import dataclass
from enum import StrEnum
from functools import cache
from importlib import resources
from typing import Final

_FLOOR_PATTERN: Final = re.compile(r"(\d+)\.(\d+)\Z")
_VERSION_PATTERN: Final = re.compile(r"(\d+)\.(\d+)")


class VersionUnit(StrEnum):
    MAJOR = "major"
    MINOR = "minor"


@dataclass(frozen=True, slots=True)
class MatrixFramework:
    id: str
    package: str
    unit: VersionUnit
    floor: str
    tested: tuple[str, ...]
    incompatible: dict[str, str]

    def unit_of(self, major: int, minor: int) -> str:
        return str(major) if self.unit is VersionUnit.MAJOR else f"{major}.{minor}"

    def tested_items(self) -> list[str]:
        """The `allowUntested` items that name a tested unit."""
        return [f"{self.id}@{unit}" for unit in self.tested]

    def is_below_floor(self, major: int, minor: int) -> bool:
        floor = _FLOOR_PATTERN.match(self.floor)

        if floor is None:
            raise ValueError(f"seampact-ir: the floor of {self.package} is not <major>.<minor>; reinstall seampact-ir.")

        return (major, minor) < (int(floor.group(1)), int(floor.group(2)))

    @property
    def tested_text(self) -> str:
        return ", ".join(self.tested)


@dataclass(frozen=True, slots=True)
class MatrixTarget:
    """A target's `use` and the frameworks it is checked against: the one it serves, then its companions."""

    use: str
    frameworks: tuple[MatrixFramework, ...]


def parse_version(version: str) -> tuple[int, int] | None:
    match = _VERSION_PATTERN.match(version)

    return (int(match.group(1)), int(match.group(2))) if match else None


@cache
def python_targets() -> dict[str, MatrixTarget]:
    """The Python targets of the shipped matrix, by their `use`."""
    text = (resources.files("seampact.ir") / "compatibility" / "python-targets.json").read_text(encoding="utf-8")
    matrix = json.loads(text)
    targets = matrix.get("pythonTargets") if isinstance(matrix, dict) else None

    if not isinstance(targets, list):
        raise ValueError(
            "seampact-ir: compatibility/python-targets.json has no pythonTargets list; reinstall seampact-ir."
        )

    return {target["package"]: _target_of(target) for target in targets}


def _target_of(target: dict[str, object]) -> MatrixTarget:
    framework = target["framework"]
    companions = target.get("companions", [])

    if not isinstance(framework, dict) or not isinstance(companions, list):
        raise ValueError(
            "seampact-ir: compatibility/python-targets.json holds a malformed target; reinstall seampact-ir."
        )

    return MatrixTarget(str(target["package"]), tuple(_framework_of(item) for item in [framework, *companions]))


def _framework_of(item: dict[str, object]) -> MatrixFramework:
    tested = item["tested"]
    incompatible = item["incompatible"]

    if not isinstance(tested, list) or not isinstance(incompatible, list):
        raise ValueError(f"seampact-ir: the matrix row of {item.get('id')} is malformed; reinstall seampact-ir.")

    return MatrixFramework(
        str(item["id"]),
        str(item["package"]),
        VersionUnit(str(item["unit"])),
        str(item["floor"]),
        tuple(str(unit) for unit in tested),
        {str(row["unit"]): str(row["reason"]) for row in incompatible},
    )
