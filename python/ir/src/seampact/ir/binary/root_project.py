"""The root project's `pyproject.toml`: the one in the project directory. Only this file sets the binary override;
a `[tool.seampact.binary]` table in a workspace member or in a locally installed dependency is refused
(`binary.override-not-root`, `dependency_overrides`)."""

import os
import tomllib
from dataclasses import dataclass
from typing import Final

from seampact.ir.binary.absolute_path import resolved
from seampact.ir.binary.failure import BinaryFailureCode, BinaryRefusedError
from seampact.ir.binary.override import BinaryOverride, read_binary_override

PYPROJECT_FILE: Final = "pyproject.toml"


@dataclass(frozen=True, slots=True)
class RootProject:
    pyproject_file: str
    directory: str
    _tool: dict[str, object]

    @staticmethod
    def locate(project_directory: str) -> "RootProject":
        """The root project of `project_directory`. A directory with no `pyproject.toml` sets no override. Raises
        `binary.pin-invalid` when the file is unreadable or `tool.seampact` is not a table."""
        directory = resolved(project_directory)
        pyproject_file = os.path.join(directory, PYPROJECT_FILE)

        if not os.path.isfile(pyproject_file):
            return RootProject(pyproject_file, directory, {})

        tool = tool_table(pyproject_file)

        return RootProject(pyproject_file, directory, tool)

    def binary_override(self) -> BinaryOverride | None:
        """The `[tool.seampact.binary]` override, or `None` when the root project sets none."""
        seampact = self._tool.get("seampact")

        if seampact is None:
            return None

        if not isinstance(seampact, dict):
            raise _invalid(f"`tool.seampact` of '{self.pyproject_file}' is not a table")

        if "binary" not in seampact:
            return None

        return read_binary_override(seampact["binary"], self.pyproject_file)


def read_toml(pyproject_file: str) -> dict[str, object]:
    try:
        with open(pyproject_file, "rb") as handle:
            return tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise _invalid(f"'{pyproject_file}' cannot be read as TOML ({error})") from error


def tool_table(pyproject_file: str) -> dict[str, object]:
    tool = read_toml(pyproject_file).get("tool", {})

    if not isinstance(tool, dict):
        raise _invalid(f"`tool` of '{pyproject_file}' is not a table")

    return tool


def _invalid(problem: str) -> BinaryRefusedError:
    return BinaryRefusedError(
        BinaryFailureCode.PIN_INVALID,
        f"{problem[0].upper()}{problem[1:]}.",
        'Make `tool.seampact` a table, such as [tool.seampact.binary] with path = "..." and sha256 = "...", or '
        "remove it.",
    )
