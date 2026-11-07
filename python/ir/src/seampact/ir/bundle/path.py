"""The portable-path rule of a bundle file: relative to the bundle root, under `sources/` or `ir/`, each segment of
`[A-Za-z0-9._@+-]`, not ending in `.` and not a Windows device name before its first `.`. The named checks say what
is wrong; the schema's `$defs/path` patterns stay the one source."""

import re
from typing import Final

from seampact.ir.bundle.layout import IR_DIRECTORY, SOURCES_DIRECTORY
from seampact.ir.bundle.spec_schema import manifest_schema_document

_TOP_DIRECTORIES: Final = (SOURCES_DIRECTORY, IR_DIRECTORY)
_UNPORTABLE_CHARACTER: Final = re.compile(r"[^A-Za-z0-9._@+-]")
_DEVICE_STEM: Final = re.compile(r"(?:con|prn|aux|nul|com[0-9]|lpt[0-9])\Z")
_ASCII_UPPER: Final = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_FOLD_TABLE: Final = str.maketrans(_ASCII_UPPER, _ASCII_UPPER.lower())


def fold(path: str) -> str:
    """The key two paths share when they differ only in ASCII letter case (a case-insensitive file system)."""
    return path.translate(_FOLD_TABLE)


def path_problem(path: str) -> str | None:
    """Why `path` is not a portable bundle path, or `None` when it is one."""
    max_length, pattern, device_pattern = _path_definition()

    if len(path) > max_length:
        return f"is longer than {max_length} characters"

    segments = path.split("/")

    if segments[0] not in _TOP_DIRECTORIES or len(segments) < 2:
        return "is not a file under sources/ or ir/"

    for segment in segments:
        problem = _segment_problem(segment)

        if problem is not None:
            return problem

    if pattern.search(path) is None or device_pattern.search(path) is not None:
        return "does not match the portable path pattern"

    return None


def _segment_problem(segment: str) -> str | None:
    if segment in ("", ".", ".."):
        return "has an empty, '.' or '..' segment"

    unportable = _UNPORTABLE_CHARACTER.search(segment)

    if unportable is not None:
        return f"holds U+{ord(unportable.group()):04X}, outside the portable characters A-Z a-z 0-9 . _ @ + -"

    if segment.endswith("."):
        return f"has the segment '{segment}', ending in '.' (Windows drops it)"

    if _DEVICE_STEM.match(fold(segment.split(".")[0])) is not None:
        return f"has the segment '{segment}', a Windows device name (CON, PRN, AUX, NUL, COM0-9, LPT0-9)"

    return None


def _path_definition() -> tuple[int, re.Pattern[str], re.Pattern[str]]:
    definitions = manifest_schema_document().get("$defs")
    path = definitions.get("path") if isinstance(definitions, dict) else None
    negated = path.get("not") if isinstance(path, dict) else None
    max_length = path.get("maxLength") if isinstance(path, dict) else None
    pattern = path.get("pattern") if isinstance(path, dict) else None
    device_pattern = negated.get("pattern") if isinstance(negated, dict) else None

    if not isinstance(max_length, int) or not isinstance(pattern, str) or not isinstance(device_pattern, str):
        raise ValueError("seampact-ir: the manifest schema has no readable $defs/path; reinstall seampact-ir.")

    return max_length, _compiled(pattern), _compiled(device_pattern)


def _compiled(ecma_pattern: str) -> re.Pattern[str]:
    # `$` of the schema's ECMA patterns is the end of the text; Python's also matches before a final newline.
    return re.compile(ecma_pattern.replace("$", r"\Z"))
