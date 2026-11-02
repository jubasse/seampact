"""Finds the target of a `pypi:<distribution>` `use` among the installed distributions: the distribution of that name,
its `seampact.generators` entry point, which loads a class implementing `Generator` that is built with no argument.
Each miss is refused by name, with the Node CLI's codes for a target package."""

import re
from collections.abc import Iterable
from dataclasses import dataclass
from importlib import metadata
from typing import Final

from seampact.ir.config.problem import ConfigProblem
from seampact.ir.run.generator import ENTRY_POINT_GROUP, Generator

_PYPI_PREFIX: Final = "pypi:"
_SEPARATORS: Final = re.compile(r"[-_.]+")


@dataclass(frozen=True, slots=True)
class InstalledTarget:
    """A target distribution found among the installed ones: its name, its version and its generator."""

    distribution: str
    version: str
    generator: Generator


def normalized_name(name: str) -> str:
    """The PEP 503 normalised name."""
    return _SEPARATORS.sub("-", name).lower()


def installed_versions(distributions: Iterable[metadata.Distribution]) -> dict[str, str]:
    """The version of each installed distribution, by normalised name; the first on the path wins, as imports do."""
    versions: dict[str, str] = {}

    for distribution in distributions:
        name = distribution.metadata["Name"]

        if name and normalized_name(name) not in versions:
            versions[normalized_name(name)] = distribution.version

    return versions


def discover_target(
    use: str, entry_id: str, distributions: Iterable[metadata.Distribution]
) -> InstalledTarget | ConfigProblem:
    where = f"entry '{entry_id}' use"
    name = normalized_name(use.removeprefix(_PYPI_PREFIX))
    found = next((item for item in distributions if normalized_name(item.metadata["Name"] or "") == name), None)

    if found is None:
        return ConfigProblem(
            "config.target.missing",
            f"The target distribution '{name}' is not installed.",
            f"Install it with `pip install {name}`, or correct the entry's `use`.",
            where,
        )

    entry_points = list(found.entry_points.select(group=ENTRY_POINT_GROUP))

    if not entry_points:
        return ConfigProblem(
            "config.target.not-a-target",
            f"The distribution '{name}' is installed but is not a seampact target: it declares no "
            f"'{ENTRY_POINT_GROUP}' entry point.",
            "Name a seampact target distribution in `use`, such as pypi:seampact-fastapi.",
            where,
        )

    if len(entry_points) > 1:
        return _load_failed(name, "it declares more than one generator entry point", where)

    generator = _generator_of(entry_points[0])

    if isinstance(generator, str):
        return _load_failed(name, f"{generator}", where)

    # The version goes into every generated file's header, so a distribution without one is refused, never guessed.
    if not found.version:
        return ConfigProblem(
            "config.target.installed-unreadable",
            f"The installed distribution '{name}' has no version in its metadata.",
            f"Reinstall '{name}', then run seampact again.",
            where,
        )

    return InstalledTarget(name, found.version, generator)


def _load_failed(name: str, reason: str, where: str) -> ConfigProblem:
    return ConfigProblem(
        "config.target.load-failed",
        f"The generator of the distribution '{name}' cannot be loaded: {reason}.",
        f"Reinstall '{name}', or update it to a release whose generator implements seampact.ir.run.Generator.",
        where,
    )


def _generator_of(entry_point: metadata.EntryPoint) -> Generator | str:
    """The generator, or why it cannot be built."""
    try:
        target = entry_point.load()
    except Exception as error:
        return f"importing '{entry_point.value}' failed ({type(error).__name__}: {error})"

    if not isinstance(target, type):
        return f"'{entry_point.value}' is not a class"

    try:
        instance = target()
    except Exception as error:
        return f"it cannot be built with no argument ({type(error).__name__}: {error})"

    if not isinstance(instance, Generator):
        return "it does not implement seampact.ir.run.Generator (ir_support, framework_docs_off_fix and generate)"

    return instance
