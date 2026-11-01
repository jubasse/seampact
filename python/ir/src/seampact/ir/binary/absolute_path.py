"""Absolute paths for the binary channel: a path is made absolute once, before any check, and then used as is, so the
file checked and the file started are one file whatever directory the child starts in."""

import os
import re
import sys
from typing import Final

from seampact.ir.binary.failure import BinaryFailureCode, BinaryRefusedError

_WINDOWS_DRIVE_PATH: Final = re.compile(r"[A-Za-z]:[\\/]")


def is_absolute(path: str) -> bool:
    """Whether `path` is absolute on this host: `is_absolute_on_windows` on Windows, else `is_absolute_on_posix`."""
    return is_absolute_on_windows(path) if sys.platform == "win32" else is_absolute_on_posix(path)


def is_absolute_on_posix(path: str) -> bool:
    """A path from the filesystem root; `\\x` and `C:/x` are relative names on POSIX."""
    return path.startswith("/")


def is_absolute_on_windows(path: str) -> bool:
    """A drive path, a UNC path or a path from the root of the current drive."""
    return path.startswith(("/", "\\")) or _WINDOWS_DRIVE_PATH.match(path) is not None


def resolved(path: str) -> str:
    """`path` itself when absolute, else `path` below the working directory of this process."""
    if is_absolute(path):
        return path

    try:
        working_directory = os.getcwd()
    except OSError as error:
        raise BinaryRefusedError(
            BinaryFailureCode.COMPILE_FAILED,
            f"The relative path '{path}' cannot be made absolute: the working directory cannot be read ({error}).",
            "Run seampact from a directory your user can read, or pass absolute paths.",
        ) from error

    return os.path.join(working_directory, path)
