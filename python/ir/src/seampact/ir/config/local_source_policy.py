"""Refusing local sources on shared branches (ADR 0011): `allowLocal` in the config, true when absent, and the
environment variable `SEAMPACT_ALLOW_LOCAL`, whose `false` forces the refusal and whose other values never lift a
`false` the config holds. A local source is a `path` source, or a git bundle source naming a local repository."""

from collections.abc import Mapping
from enum import Enum
from typing import Final

ALLOW_LOCAL_VARIABLE: Final = "SEAMPACT_ALLOW_LOCAL"
_FORCED_REFUSAL: Final = "false"


class LocalSourcePolicy(Enum):
    ALLOW = "allow"
    REFUSE = "refuse"

    @staticmethod
    def of(configured: bool | None, environment: Mapping[str, str]) -> "LocalSourcePolicy":
        refused = _is_forced(environment) or configured is False

        return LocalSourcePolicy.REFUSE if refused else LocalSourcePolicy.ALLOW


def refusal_reason(environment: Mapping[str, str]) -> str:
    """Which setting refuses local sources, for a message: the environment variable wins."""
    return f"{ALLOW_LOCAL_VARIABLE}={_FORCED_REFUSAL}" if _is_forced(environment) else "allowLocal: false"


def _is_forced(environment: Mapping[str, str]) -> bool:
    return environment.get(ALLOW_LOCAL_VARIABLE) == _FORCED_REFUSAL
