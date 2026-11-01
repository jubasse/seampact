"""The environment the binary starts with: only the variables of its contract, `TMPDIR`, `TEMP`, `TMP` and, on
Windows, `SystemRoot`, so no code the environment names (an OpenSSL configuration, a `NODE_OPTIONS` require) runs
inside the pinned binary. Windows names are case-insensitive."""

from collections.abc import Mapping
from typing import Final

_CONTRACT_VARIABLES: Final = ("TMPDIR", "TEMP", "TMP")
_WINDOWS_VARIABLES: Final = ("SYSTEMROOT",)


def child_environment(parent: Mapping[str, str], *, windows: bool) -> dict[str, str]:
    allowed = (*_CONTRACT_VARIABLES, *_WINDOWS_VARIABLES) if windows else _CONTRACT_VARIABLES

    return {name: value for name, value in parent.items() if (name.upper() if windows else name) in allowed}
