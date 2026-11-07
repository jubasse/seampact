"""The runner a target entry's `use` belongs to: the forms cannot be confused (ADR 0011)."""

from enum import Enum
from typing import Final

_PYPI_PREFIX: Final = "pypi:"


class TargetEcosystem(Enum):
    MAVEN = "maven"
    NPM = "npm"
    COMPOSER = "composer"
    PYPI = "pypi"

    @staticmethod
    def of(use: str) -> "TargetEcosystem":
        """npm names never hold a colon, and an unscoped npm name never holds a slash."""
        if use.startswith(_PYPI_PREFIX):
            return TargetEcosystem.PYPI

        if ":" in use:
            return TargetEcosystem.MAVEN

        if not use.startswith(("@", ".")) and "/" in use:
            return TargetEcosystem.COMPOSER

        return TargetEcosystem.NPM
