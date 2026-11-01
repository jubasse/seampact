"""A config path (a `path` source, `outDir`, `out`), relative to the directory of the config that writes it, made
absolute and normalised by its text alone: `.` and `..` segments resolved, never through the filesystem."""

import os
import re
from typing import Final

from seampact.ir.binary.absolute_path import is_absolute

_ROOT_PREFIX: Final = re.compile(r"(?:[A-Za-z]:)?/")


def resolve_config_path(directory: str, path: str) -> str:
    joined = path if is_absolute(path) else f"{directory.rstrip('/')}/{path}"

    return normalize_config_path(joined)


def normalize_config_path(path: str) -> str:
    if os.sep == "\\":
        path = path.replace("\\", "/")

    prefix_match = _ROOT_PREFIX.match(path)
    prefix = prefix_match.group() if prefix_match else ""
    segments: list[str] = []

    for segment in path[len(prefix) :].split("/"):
        if segment in ("", "."):
            continue

        if segment == "..":
            if segments:
                segments.pop()

            continue

        segments.append(segment)

    return prefix + "/".join(segments)


def is_at_or_below_directory(path: str, directory: str) -> bool:
    """Whether `path` is `directory` itself or a path below it."""
    return path == directory or path.startswith(directory.rstrip("/") + "/")
