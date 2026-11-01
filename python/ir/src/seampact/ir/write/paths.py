"""The paths a target may generate: relative POSIX paths that stay inside its output root, each once."""

from typing import Final

from seampact.ir.write.code_unit_order import code_unit_key
from seampact.ir.write.generated_file import GeneratedFile
from seampact.ir.write.manifest import MANIFEST_FILE_NAME
from seampact.ir.write.refusal import WriterRefusal
from seampact.ir.write.safe_path import unsafe_path_reason

_REPORT_FIX: Final = (
    "Report this to the target's maintainers: a target emits distinct relative POSIX paths inside its output root."
)


def checked_files(files: list[GeneratedFile]) -> list[GeneratedFile] | list[WriterRefusal]:
    """Each unsafe, duplicate or reserved path refused, else the files in code-unit order of path."""
    seen: set[str] = set()
    refusals: list[WriterRefusal] = []

    for file in files:
        reason = unsafe_path_reason(file.path) or _other_reason(file.path, seen)

        if reason is not None:
            refusals.append(
                WriterRefusal(
                    "file.path.invalid", f"The target generated the path '{file.path}', and {reason}.", _REPORT_FIX
                )
            )

        seen.add(file.path)

    if refusals:
        return refusals

    return sorted(files, key=lambda file: code_unit_key(file.path))


def _other_reason(path: str, seen: set[str]) -> str | None:
    try:
        path.encode("utf-8")
    except UnicodeEncodeError:
        return "it is not UTF-8"

    if path in seen:
        return "it is generated twice"

    if path.rsplit("/", 1)[-1] == MANIFEST_FILE_NAME:
        return f"'{MANIFEST_FILE_NAME}' is the writer's manifest"

    return None
