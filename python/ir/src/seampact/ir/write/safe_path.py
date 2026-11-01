"""Whether a path is one a target may generate: relative, POSIX and inside the output directory."""

import re
from typing import Final

_DRIVE_PREFIX: Final = re.compile(r"[A-Za-z]:")


def unsafe_path_reason(path: str) -> str | None:
    """Why `path` is not a relative POSIX path that stays inside the output directory, or None when it is."""
    if path == "":
        return "it is empty"

    if "\\" in path:
        return "it contains a backslash; paths use '/'"

    if path.startswith("/") or _DRIVE_PREFIX.match(path):
        return "it has an absolute prefix"

    if "\0" in path:
        return "it contains a NUL character"

    if any(segment in ("", ".", "..") for segment in path.split("/")):
        return "it has an empty, '.' or '..' segment"

    return None
