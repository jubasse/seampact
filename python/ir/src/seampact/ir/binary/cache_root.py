"""The binary cache root: `$XDG_CACHE_HOME/seampact`, else `$HOME/.cache/seampact`; on Windows
`%LOCALAPPDATA%\\seampact`, whose ACL is per user. A relative `XDG_CACHE_HOME` is ignored, as the XDG specification
says; any other relative variable is refused by name, so the cache never depends on the directory a command
starts in."""

from collections.abc import Mapping
from typing import Final

from seampact.ir.binary.absolute_path import is_absolute_on_posix, is_absolute_on_windows
from seampact.ir.binary.failure import BinaryFailureCode, BinaryRefusedError

_DIRECTORY: Final = "seampact"
# A relative value of this variable is ignored (XDG Base Directory specification); others are refused.
_IGNORED_WHEN_RELATIVE: Final = "XDG_CACHE_HOME"


def locate_cache_root(environment: Mapping[str, str], *, windows: bool) -> str:
    """An absolute path. Raises `binary.cache-unavailable` when none of the variables is set or the one read is
    relative."""
    candidates = [("LOCALAPPDATA", "")] if windows else [(_IGNORED_WHEN_RELATIVE, ""), ("HOME", "/.cache")]
    separator = "\\" if windows else "/"

    for variable, below in candidates:
        base = environment.get(variable, "")
        is_absolute = is_absolute_on_windows(base) if windows else is_absolute_on_posix(base)

        if base == "" or (not is_absolute and variable == _IGNORED_WHEN_RELATIVE):
            continue

        if not is_absolute:
            raise _relative(variable, base)

        return f"{base.rstrip('/\\')}{below}{separator}{_DIRECTORY}"

    names = ", ".join(variable for variable, _ in candidates)

    raise BinaryRefusedError(
        BinaryFailureCode.CACHE_UNAVAILABLE,
        f"No cache directory for the compiler binary: none of {names} is set.",
        "Run seampact as a Windows user with a profile (LOCALAPPDATA set)."
        if windows
        else "Set XDG_CACHE_HOME or HOME to a directory private to your user.",
    )


def _relative(variable: str, value: str) -> BinaryRefusedError:
    return BinaryRefusedError(
        BinaryFailureCode.CACHE_UNAVAILABLE,
        f"{variable} is the relative path '{value}', so the binary cache would depend on the directory seampact "
        "starts in.",
        f'Set {variable} to an absolute path, such as "$PWD/{value}" in your CI configuration.',
    )
