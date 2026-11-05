"""The version check of a release build: `seampact-compiler` is at the release version, and the `compiler` extra of
`seampact-ir` pins that same version, so `seampact-ir[compiler]` resolves the wheels this release builds. Prints the
version the pins and the wheels carry.

    python3 release_version.py <repository root> [--release <the release version of a call>]
"""

import argparse
import sys
import tomllib
from pathlib import Path
from typing import Final

COMPILER_PROJECT: Final = Path("python", "compiler", "pyproject.toml")
IR_PROJECT: Final = Path("python", "ir", "pyproject.toml")
COMPILER_EXTRA: Final = "compiler"
COMPILER_PIN_PREFIX: Final = "seampact-compiler=="


class ReleaseVersionError(Exception):
    """A checkout the release cannot build from, with the fix in the message."""


def release_version(repository: Path, release: str | None) -> str:
    """The version of the build: the release's in a call, else the checkout's. Raises `ReleaseVersionError` when a
    call names no version, or when the compiler or the extra is at another version."""
    compiler_version = _compiler_version(repository / COMPILER_PROJECT)
    extra_version = _compiler_extra_version(repository / IR_PROJECT)

    if extra_version != compiler_version:
        raise ReleaseVersionError(
            f"The `{COMPILER_EXTRA}` extra of {IR_PROJECT} pins seampact-compiler {extra_version}, but "
            f"{COMPILER_PROJECT} is at {compiler_version}: stamp both with the same version."
        )

    if release is None:
        return compiler_version

    if release == "":
        raise ReleaseVersionError(
            "The call's `version` input is empty: pass the release version, and check that the caller's expression "
            "names an output that exists."
        )

    if release != compiler_version:
        raise ReleaseVersionError(
            f"The release is {release}, but {COMPILER_PROJECT} is at {compiler_version}: call this workflow on the "
            "commit that stamps the release version."
        )

    return release


def _project_table(pyproject: Path) -> dict[str, object]:
    with pyproject.open("rb") as file:
        project: dict[str, object] = tomllib.load(file)["project"]

    return project


def _compiler_version(pyproject: Path) -> str:
    version = _project_table(pyproject).get("version")

    if not isinstance(version, str):
        raise ReleaseVersionError(f"{pyproject} has no `project.version` string: give seampact-compiler its version.")

    return version


def _compiler_extra_version(pyproject: Path) -> str:
    extras = _project_table(pyproject).get("optional-dependencies")
    requirements = extras.get(COMPILER_EXTRA) if isinstance(extras, dict) else None
    pins = [
        requirement
        for requirement in (requirements if isinstance(requirements, list) else [])
        if isinstance(requirement, str) and requirement.startswith(COMPILER_PIN_PREFIX)
    ]

    if len(pins) != 1:
        raise ReleaseVersionError(
            f"The `{COMPILER_EXTRA}` extra of {pyproject} has no single `{COMPILER_PIN_PREFIX}<version>` requirement: "
            "pin seampact-compiler there to the version of python/compiler."
        )

    return pins[0].removeprefix(COMPILER_PIN_PREFIX)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repository", type=Path)
    parser.add_argument("--release")
    arguments = parser.parse_args()

    try:
        print(release_version(arguments.repository, arguments.release))
    except ReleaseVersionError as error:
        sys.exit(str(error))


if __name__ == "__main__":
    main()
