"""The paths a target may generate: relative POSIX paths that stay inside its output root, each once."""

from dataclasses import dataclass, field
from typing import Final

from seampact.ir.write.code_unit_order import code_unit_key
from seampact.ir.write.generated_file import GeneratedFile
from seampact.ir.write.manifest import MANIFEST_FILE_NAME
from seampact.ir.write.refusal import WriterRefusal
from seampact.ir.write.safe_path import unsafe_path_reason

_REPORT_FIX: Final = (
    "Report this to the target's maintainers, or, if two paths differ only by letter case, rename one of the two "
    "contract names: a target emits distinct relative POSIX paths inside its output root."
)


@dataclass(slots=True)
class _SeenPaths:
    """The paths seen so far, by exact spelling and by case-folded key."""

    exact_paths: set[str] = field(default_factory=set)
    file_by_folded_path: dict[str, str] = field(default_factory=dict)
    directory_by_folded_path: dict[str, str] = field(default_factory=dict)


def case_folded(path: str) -> str:
    """The key two paths share on a case-insensitive file system. Lower, upper, then lower case: the same answer in
    the four writers (a plain case fold treats the capital sharp s and the dotless i differently), as ADR 0015 says."""
    return path.lower().upper().lower()


def checked_files(files: list[GeneratedFile]) -> list[GeneratedFile] | list[WriterRefusal]:
    """Each unsafe, duplicate or reserved path refused, else the files in code-unit order of path."""
    seen = _SeenPaths()
    refusals: list[WriterRefusal] = []

    for file in files:
        reason = unsafe_path_reason(file.path) or _other_reason(file.path, seen)

        if reason is not None:
            refusals.append(
                WriterRefusal(
                    "file.path.invalid", f"The target generated the path '{file.path}', and {reason}.", _REPORT_FIX
                )
            )

        if _is_checkable(file.path):
            _remember(file.path, seen)

    if refusals:
        return refusals

    return sorted(files, key=lambda file: code_unit_key(file.path))


def _is_utf8(path: str) -> bool:
    try:
        path.encode("utf-8")
    except UnicodeEncodeError:
        return False

    return True


def _is_checkable(path: str) -> bool:
    return unsafe_path_reason(path) is None and _is_utf8(path)


def _directory_prefixes(path: str) -> list[str]:
    """Each directory of the path, from the outermost: `a/b/c.py` has `a` and `a/b`."""
    segments = path.split("/")

    return ["/".join(segments[:count]) for count in range(1, len(segments))]


def _remember(path: str, seen: _SeenPaths) -> None:
    seen.exact_paths.add(path)
    seen.file_by_folded_path.setdefault(case_folded(path), path)

    for directory in _directory_prefixes(path):
        seen.directory_by_folded_path.setdefault(case_folded(directory), directory)


def _other_reason(path: str, seen: _SeenPaths) -> str | None:
    if not _is_utf8(path):
        return "it is not UTF-8"

    if path in seen.exact_paths:
        return "it is generated twice"

    folded = case_folded(path)
    earlier_file = seen.file_by_folded_path.get(folded)

    if earlier_file is not None:
        return f"it differs only by letter case from '{earlier_file}'"

    earlier_directory = seen.directory_by_folded_path.get(folded)

    if earlier_directory is not None:
        return f"it is a file, and an earlier path uses '{earlier_directory}' as a directory"

    return _directory_reason(path, seen) or _manifest_reason(path)


def _directory_reason(path: str, seen: _SeenPaths) -> str | None:
    for directory in _directory_prefixes(path):
        folded = case_folded(directory)
        file_at_directory = seen.file_by_folded_path.get(folded)

        if file_at_directory is not None:
            return f"its directory '{directory}' is also the file '{file_at_directory}'"

        earlier_directory = seen.directory_by_folded_path.get(folded)

        if earlier_directory is not None and earlier_directory != directory:
            return (
                f"its directory '{directory}' differs only by letter case from the directory "
                f"'{earlier_directory}' of an earlier path"
            )

    return None


def _manifest_reason(path: str) -> str | None:
    if path.rsplit("/", 1)[-1] == MANIFEST_FILE_NAME:
        return f"'{MANIFEST_FILE_NAME}' is the writer's manifest"

    return None
