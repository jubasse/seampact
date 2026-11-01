"""The C library of a Linux host; other systems have none to tell apart."""

import os
from enum import StrEnum
from typing import Final

_MUSL_LOADER_PREFIX: Final = "ld-musl-"
_LIBRARY_DIRECTORY: Final = "/lib"


class HostLibc(StrEnum):
    GLIBC = "glibc"
    MUSL = "musl"
    UNKNOWN = "unknown"
    NONE = "none"


def linux_libc(glibc_version: str | None, library_entries: list[str]) -> HostLibc:
    """glibc when `os.confstr("CS_GNU_LIBC_VERSION")` answered (`glibc_version`); otherwise the loaders under `/lib`
    decide: `ld-musl-*` is musl, anything else unknown."""
    if glibc_version is not None:
        return HostLibc.GLIBC

    if any(entry.startswith(_MUSL_LOADER_PREFIX) for entry in library_entries):
        return HostLibc.MUSL

    return HostLibc.UNKNOWN


def current_linux_libc() -> HostLibc:
    return linux_libc(_glibc_version(), os.listdir(_LIBRARY_DIRECTORY) if os.path.isdir(_LIBRARY_DIRECTORY) else [])


def _glibc_version() -> str | None:
    try:
        return os.confstr("CS_GNU_LIBC_VERSION")
    except (ValueError, OSError):
        # musl has no such name: the question has no answer there, and the loader decides.
        return None
