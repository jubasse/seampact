"""Writes a target's files into its output directory (ADR 0015 "Writing files"), as the Node writer
(`codegen-core/src/writer.ts`) and the JVM writer do, with their codes: UTF-8 without a byte-order mark, LF line
endings and a final newline, only inside the output directory, with `.seampact-manifest.json` listing each file and
its SHA-256. Files a previous run generated and this one does not are removed. Every check runs before the first
write: a manifest that is not a regular file or belongs to another target, a file the writer did not generate, a
hand-edited one (unless `HandEditPolicy.OVERWRITE`, the `--force` semantics) or a path leaving the directory through
a link refuses the whole write, naming the file and the fix."""

import hashlib
import os
from dataclasses import dataclass
from typing import Final

from seampact.ir.write.code_unit_order import code_unit_key
from seampact.ir.write.generated_file import GeneratedFile
from seampact.ir.write.manifest import MANIFEST_FILE_NAME, read_manifest, serialized_manifest
from seampact.ir.write.paths import case_folded, checked_files
from seampact.ir.write.policy import HandEditPolicy
from seampact.ir.write.refusal import WriterRefusal

_BYTE_ORDER_MARK: Final = "﻿"
_HAND_EDIT_FIX: Final = (
    "Move the hand-written code next to the generated files, then delete the edited file and run "
    "`seampact generate` again, or run `seampact generate --force` to write over it."
)


@dataclass(frozen=True, slots=True)
class PlannedWrite:
    """A write whose checks all passed, not yet done. `bytes_by_path` holds each planned file's bytes in code-unit
    order of path; `unchanged` the planned paths whose bytes are on disk already; `removable` the paths a previous
    run generated that this one does not."""

    root_dir: str
    owner: str
    bytes_by_path: dict[str, bytes]
    unchanged: list[str]
    removable: list[str]

    def changed(self) -> list[str]:
        """The paths a commit writes: each planned file whose bytes differ from the file on disk, or that is missing."""
        return [path for path in self.bytes_by_path if path not in self.unchanged]


@dataclass(frozen=True, slots=True)
class WrittenFiles:
    written: list[str]
    unchanged: list[str]
    removed: list[str]


def plan_write(
    out_dir: str, owner: str, files: list[GeneratedFile], on_hand_edit: HandEditPolicy
) -> PlannedWrite | list[WriterRefusal]:
    """Every check of a write of `files` into `out_dir` for the target entry `owner`, with nothing written, so a
    caller writing several directories checks them all first."""
    checked = checked_files(files)

    if checked and isinstance(checked[0], WriterRefusal):
        return [item for item in checked if isinstance(item, WriterRefusal)]

    root_dir = _real_path_of_missing(out_dir)
    manifest_path = os.path.join(root_dir, MANIFEST_FILE_NAME)

    if os.path.lexists(manifest_path) and (os.path.islink(manifest_path) or not os.path.isfile(manifest_path)):
        return [
            WriterRefusal(
                "writer.manifest.not-regular",
                f"The manifest {manifest_path} is not a regular file, so the writer does not read or write it.",
                f"Delete {manifest_path}, then generate again.",
            )
        ]

    manifest = read_manifest(root_dir)

    if isinstance(manifest, str):
        return [
            WriterRefusal(
                "writer.manifest.invalid",
                f"The manifest {manifest_path} cannot be read: {manifest}.",
                "Delete the generated files of this target and its manifest, then generate again.",
            )
        ]

    if manifest.owner is not None and manifest.owner != owner:
        return [
            WriterRefusal(
                "writer.manifest.other-owner",
                f"The output directory {root_dir} belongs to the target '{manifest.owner}', not '{owner}'.",
                f"Give '{owner}' its own `out` directory, or delete {manifest_path} and the files of "
                f"'{manifest.owner}'.",
            )
        ]

    bytes_by_path = {file.path: _normalized_bytes(file.contents) for file in checked if isinstance(file, GeneratedFile)}

    return _plan_files(root_dir, owner, bytes_by_path, manifest.hash_by_path, on_hand_edit)


def commit_write(write: PlannedWrite) -> WrittenFiles:
    """Writes a planned write: the changed files, the removal of the stale ones, then the manifest."""
    os.makedirs(write.root_dir, exist_ok=True)
    written = write.changed()

    for path in written:
        target = os.path.join(write.root_dir, path)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        _write_file(target, write.bytes_by_path[path])

    for path in write.removable:
        target = os.path.join(write.root_dir, path)

        try:
            os.unlink(target)
        except OSError as error:
            raise OSError(
                f"seampact: removing the stale generated file '{target}' failed ({error}); check its permissions, "
                "then generate again."
            ) from error

        _remove_empty_directories(write.root_dir, os.path.dirname(target))

    hash_by_path = {path: hashlib.sha256(data).hexdigest() for path, data in write.bytes_by_path.items()}
    manifest_text = serialized_manifest(write.owner, hash_by_path)
    _write_file(os.path.join(write.root_dir, MANIFEST_FILE_NAME), manifest_text.encode("utf-8"))

    return WrittenFiles(written, write.unchanged, write.removable)


def _plan_files(
    root_dir: str,
    owner: str,
    bytes_by_path: dict[str, bytes],
    recorded: dict[str, str],
    on_hand_edit: HandEditPolicy,
) -> PlannedWrite | list[WriterRefusal]:
    refusals: list[WriterRefusal] = []
    unchanged: list[str] = []
    removable: list[str] = []
    stale_by_folded_path = {case_folded(path): path for path in recorded if path not in bytes_by_path}

    for path, data in bytes_by_path.items():
        state = _existing_file_state(
            root_dir, path, recorded.get(path), on_hand_edit, stale_by_folded_path.get(case_folded(path))
        )

        if isinstance(state, WriterRefusal):
            refusals.append(state)
        elif state == hashlib.sha256(data).hexdigest():
            unchanged.append(path)

    for path, sha256 in recorded.items():
        if path in bytes_by_path:
            continue

        state = _existing_file_state(root_dir, path, sha256, on_hand_edit)

        if isinstance(state, WriterRefusal):
            refusals.append(state)
        elif state is not None:
            removable.append(path)

    if refusals:
        return refusals

    return PlannedWrite(root_dir, owner, bytes_by_path, unchanged, sorted(removable, key=code_unit_key))


def _existing_file_state(
    root_dir: str,
    path: str,
    recorded_sha256: str | None,
    on_hand_edit: HandEditPolicy,
    case_renamed_from: str | None = None,
) -> str | WriterRefusal | None:
    """What is at `path` now: nothing (None), the SHA-256 of the file, or a refusal. `case_renamed_from` is the
    path a previous run generated that `path` only differs from by letter case."""
    file = os.path.join(root_dir, path)

    if _leaves_root(root_dir, file):
        return WriterRefusal(
            "writer.path.outside",
            f"'{file}' resolves outside the output directory {root_dir} through a symbolic link.",
            "Replace the symbolic link in the output directory with a plain directory.",
        )

    if not os.path.lexists(file):
        return None

    if os.path.islink(file) or not os.path.isfile(file):
        return WriterRefusal(
            "writer.file.not-generated",
            f"'{file}' is not a regular file, so the writer did not generate it.",
            f"Move it out of the output directory {root_dir}.",
        )

    if recorded_sha256 is None and case_renamed_from is not None:
        return WriterRefusal(
            "writer.file.not-generated",
            f"'{file}' exists, and the previous run generated '{case_renamed_from}', so this run renames it only by "
            "letter case; on a case-insensitive file system they are one file.",
            f"Delete '{os.path.join(root_dir, case_renamed_from)}', then generate again.",
        )

    if recorded_sha256 is None:
        return WriterRefusal(
            "writer.file.not-generated",
            f"'{file}' exists and the writer did not generate it, so it is not overwritten.",
            f"Move it out of the output directory {root_dir}, or rename it.",
        )

    with open(file, "rb") as handle:
        sha256 = hashlib.sha256(handle.read()).hexdigest()

    if sha256 != recorded_sha256 and on_hand_edit is HandEditPolicy.REFUSE:
        return WriterRefusal(
            "writer.file.edited",
            f"'{file}' was edited by hand since it was generated, so it is not overwritten or removed.",
            _HAND_EDIT_FIX,
        )

    return sha256


def _normalized_bytes(contents: str) -> bytes:
    contents = contents.removeprefix(_BYTE_ORDER_MARK)
    line_feeds = contents.replace("\r\n", "\n").replace("\r", "\n")

    return (line_feeds if line_feeds.endswith("\n") else f"{line_feeds}\n").encode("utf-8")


def _real_path_of_missing(directory: str) -> str:
    """The real path `directory` has or will have once created: its deepest existing ancestor's real path, then the
    rest."""
    if os.path.lexists(directory):
        return os.path.realpath(directory)

    parent = os.path.dirname(directory)

    if parent == directory:
        return directory

    return os.path.join(_real_path_of_missing(parent), os.path.basename(directory))


def _leaves_root(root_dir: str, file: str) -> bool:
    """True when the deepest existing directory above `file` is, once links resolve, outside `root_dir`."""
    directory = os.path.dirname(file)

    while not os.path.lexists(directory):
        # The output directory itself is not created yet, so nothing below it is a link.
        if directory == root_dir:
            return False

        directory = os.path.dirname(directory)

    real = os.path.realpath(directory)

    return not (real == root_dir or real.startswith(root_dir + os.sep))


def _remove_empty_directories(root_dir: str, directory: str) -> None:
    if directory == root_dir or not directory.startswith(root_dir + os.sep) or os.listdir(directory):
        return

    os.rmdir(directory)
    _remove_empty_directories(root_dir, os.path.dirname(directory))


def _write_file(path: str, data: bytes) -> None:
    with open(path, "wb") as handle:
        handle.write(data)
