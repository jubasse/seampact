"""The ustar entries of a bundle tarball (POSIX.1-1988 with pax extended headers), read block by block from the
uncompressed archive, each checked before the next is read; a file's bytes stay in the archive, located by offset
and size: regular files and directories only, pax extended headers for `path` and `size` only, global pax headers
ignored, every other type refused; a file is the manifest or a portable bundle path, a directory one of their
parents; no duplicate (also once folded to ASCII lower case) or path that is both a file and a directory. Entry
names are untrusted: quoted in messages, kept exact in `file`."""

import re
from dataclasses import dataclass
from typing import Final

from seampact.ir.bundle.failure import BundleFailure, BundleFailureCode
from seampact.ir.bundle.layout import (
    ENTRIES_MAX,
    IR_DIRECTORY,
    MANIFEST_FILE,
    NOT_A_BUNDLE_FIX,
    REBUILD_FIX,
    SOURCES_DIRECTORY,
)
from seampact.ir.bundle.path import fold, path_problem
from seampact.ir.https.untrusted_text import quoted

_BLOCK_BYTES: Final = 512

# (offset, length) of each header field.
_NAME: Final = (0, 100)
_SIZE: Final = (124, 12)
_CHECKSUM: Final = (148, 8)
_TYPE: Final = (156, 1)
_MAGIC: Final = (257, 6)
_VERSION: Final = (263, 2)
_PREFIX: Final = (345, 155)
# The magic and version fields read as one, as GNU writes them.
_GNU_MAGIC_FIELD: Final = (257, 8)

_USTAR_MAGIC: Final = b"ustar\0"
_USTAR_VERSION: Final = b"00"
# GNU tar's magic and version, one 8-byte field: read like ustar's, since its regular and directory entries agree.
_GNU_MAGIC_AND_VERSION: Final = b"ustar  \0"
_TYPE_FILE: Final = b"0"
# Pre-POSIX archives mark a regular file with a NUL type.
_TYPE_FILE_OLD: Final = b"\0"
_TYPE_DIRECTORY: Final = b"5"
_PAX_TYPE_EXTENDED: Final = b"x"
_PAX_TYPE_GLOBAL: Final = b"g"
_CHECKSUM_SPACE: Final = 0x20

_OCTAL: Final = re.compile(rb"[0-7]{1,21}\Z")
_PAX_LENGTH: Final = re.compile(rb"[0-9]{1,18}\Z")
_PAX_SIZE: Final = re.compile(rb"[0-9]{1,18}\Z")
_DRIVE_PREFIX: Final = re.compile(r"[A-Za-z]:")


@dataclass(frozen=True, slots=True)
class ArchiveEntry:
    """One regular file of a bundle tarball: its path, and the offset and size of its bytes in the archive."""

    path: str
    offset: int
    size: int


def archive_invalid(reason: str, file: str | None = None) -> BundleFailure:
    return BundleFailure(BundleFailureCode.ARCHIVE_INVALID, f"The tarball cannot be read: {reason}.", REBUILD_FIX, file)


class UstarParser:
    def __init__(self, archive: bytes | bytearray) -> None:
        self._archive = archive
        self._offset = 0
        self._entry_count = 0
        self._pax_path: str | None = None
        self._pax_size: int | None = None
        self._files: list[ArchiveEntry] = []
        self._file_by_fold: dict[str, str] = {}
        # Every directory folded: an entry's or a file's parent.
        self._directory_folds: set[str] = set()

    def parse(self) -> list[ArchiveEntry] | BundleFailure:
        while True:
            if self._offset + _BLOCK_BYTES > len(self._archive):
                return archive_invalid("it ends before its end-of-archive block")

            header = self._archive[self._offset : self._offset + _BLOCK_BYTES]

            if not header.strip(b"\0"):
                return self._files

            failure = self._entry(header)

            if failure is not None:
                return failure

    def _entry(self, header: bytes | bytearray) -> BundleFailure | None:
        self._entry_count += 1

        if self._entry_count > ENTRIES_MAX:
            return BundleFailure(
                BundleFailureCode.ARCHIVE_TOO_MANY_ENTRIES,
                f"The tarball holds more than {ENTRIES_MAX} entries.",
                NOT_A_BUNDLE_FIX,
                expected=str(ENTRIES_MAX),
            )

        header_problem = _header_problem(header)

        if header_problem is not None:
            return archive_invalid(header_problem)

        entry_type = _field(header, _TYPE, keep_nul=True)
        path = self._pax_path if self._pax_path is not None else _header_path(header)
        size = self._pax_size if self._pax_size is not None else _octal(header, _SIZE)

        if size is None:
            return archive_invalid("an entry's size is not octal digits", path)

        data_start = self._offset + _BLOCK_BYTES

        if size > len(self._archive) - data_start:
            return archive_invalid("it ends inside an entry", path)

        self._offset = data_start + -(-size // _BLOCK_BYTES) * _BLOCK_BYTES

        return self._typed(entry_type, path, data_start, size)

    def _typed(self, entry_type: bytes, path: str, data_start: int, size: int) -> BundleFailure | None:
        if entry_type == _PAX_TYPE_GLOBAL:
            return None

        if entry_type == _PAX_TYPE_EXTENDED:
            return self._read_pax(self._archive[data_start : data_start + size], path)

        self._pax_path = None
        self._pax_size = None

        if entry_type == _TYPE_DIRECTORY:
            return self._directory(path)

        if entry_type in (_TYPE_FILE, _TYPE_FILE_OLD):
            return self._file(path, data_start, size)

        return BundleFailure(
            BundleFailureCode.ARCHIVE_ENTRY_TYPE,
            f"The tarball entry {quoted(path)} is of type {quoted(entry_type.decode('latin-1'))}; "
            "a bundle holds regular files only.",
            "Rebuild the bundle with `seampact bundle`: it writes no link, device or other special entry.",
            path,
        )

    def _directory(self, path: str) -> BundleFailure | None:
        trimmed = path.removesuffix("/")
        problem = _directory_path_problem(trimmed)

        if problem is not None:
            return _unsafe_path(path, problem)

        if fold(trimmed) in self._file_by_fold:
            return _unsafe_path(path, "is both a file and a directory")

        self._add_parent_directories(trimmed)
        self._directory_folds.add(fold(trimmed))

        return None

    def _file(self, path: str, data_start: int, size: int) -> BundleFailure | None:
        problem = _file_path_problem(path)

        if problem is not None:
            return _unsafe_path(path, problem)

        folded = fold(path)
        seen = self._file_by_fold.get(folded)

        if seen is not None:
            return _duplicate(path, seen)

        if folded in self._directory_folds or self._has_file_parent(path):
            return _unsafe_path(path, "is both a file and a directory")

        self._file_by_fold[folded] = path
        self._add_parent_directories(path)
        self._files.append(ArchiveEntry(path, data_start, size))

        return None

    def _has_file_parent(self, path: str) -> bool:
        return any(fold(parent) in self._file_by_fold for parent in _parent_paths(path))

    def _add_parent_directories(self, path: str) -> None:
        self._directory_folds.update(fold(parent) for parent in _parent_paths(path))

    def _read_pax(self, data: bytes | bytearray, entry_path: str) -> BundleFailure | None:
        """The records of a pax extended header, `<length> <key>=<value>\\n`: `path` and `size` are read, the others
        ignored."""
        path: str | None = None
        size: int | None = None
        offset = 0

        while offset < len(data):
            space = data.find(b" ", offset)
            length_text = data[offset:space] if space >= 0 else b""
            record_length = int(length_text) if _PAX_LENGTH.match(length_text) else 0

            if space < 0 or record_length <= 0 or record_length > len(data) - offset:
                return archive_invalid("a pax record's length is not a number inside the header", entry_path)

            record_end = offset + record_length - 1
            record = data[space + 1 : record_end] if space + 1 <= record_end else b""
            equals = record.find(b"=")

            if equals < 0 or data[record_end : record_end + 1] != b"\n":
                return archive_invalid("a pax record is not key=value", entry_path)

            key = record[:equals]
            value = record[equals + 1 :]

            if key == b"path":
                path = value.decode("utf-8", errors="replace")

            if key == b"size":
                if not _PAX_SIZE.match(value):
                    return archive_invalid("a pax size is not a decimal number", entry_path)

                size = int(value)

            offset += record_length

        self._pax_path = path
        self._pax_size = size

        return None


def _header_problem(header: bytes | bytearray) -> str | None:
    magic = _field(header, _MAGIC, keep_nul=True)
    version = _field(header, _VERSION, keep_nul=True)

    if magic != _USTAR_MAGIC and magic + version != _GNU_MAGIC_AND_VERSION:
        return "an entry is not a ustar header"

    if magic == _USTAR_MAGIC and version != _USTAR_VERSION:
        return "an entry has an unknown ustar version"

    if _octal(header, _CHECKSUM) != _checksum(header):
        return "an entry header's checksum does not match"

    return None


def _unsafe_path(path: str, problem: str) -> BundleFailure:
    return BundleFailure(
        BundleFailureCode.ARCHIVE_ENTRY_PATH,
        f"The tarball entry {quoted(path)} {problem}; a bundle holds its manifest and portable paths under "
        f"{SOURCES_DIRECTORY}/ and {IR_DIRECTORY}/ only.",
        "Rebuild the bundle with `seampact bundle`: its entries are the manifest and portable paths under the root.",
        path,
    )


def _duplicate(path: str, seen: str) -> BundleFailure:
    message = (
        f"The tarball holds {quoted(path)} twice."
        if seen == path
        else f"The tarball holds {quoted(path)} and {quoted(seen)}, one file on a case-insensitive file system."
    )

    return BundleFailure(
        BundleFailureCode.ARCHIVE_ENTRY_DUPLICATE,
        message,
        "Rebuild the bundle with `seampact bundle`: it writes each file once.",
        path,
    )


def _file_path_problem(path: str) -> str | None:
    """The manifest, or a portable bundle path."""
    if path == MANIFEST_FILE:
        return None

    return _unsafe_entry_path_problem(path) or path_problem(path)


def _directory_path_problem(path: str) -> str | None:
    """`sources`, `ir`, or a directory a portable bundle path may hold."""
    if path in (SOURCES_DIRECTORY, IR_DIRECTORY):
        return None

    return _unsafe_entry_path_problem(path) or path_problem(path)


def _unsafe_entry_path_problem(path: str) -> str | None:
    """The unsafe paths, named before the portable rule so the refusal says what makes them unsafe."""
    if path == "":
        return "has an empty path"

    if "\0" in path:
        return "holds a NUL character"

    if "\\" in path:
        return "holds a backslash"

    if path.startswith("/") or _DRIVE_PREFIX.match(path):
        return "is an absolute path"

    if {"", ".", ".."} & set(path.split("/")):
        return "has an empty, '.' or '..' segment"

    return None


def _parent_paths(path: str) -> list[str]:
    """`a`, `a/b` for `a/b/c`."""
    segments = path.split("/")

    return ["/".join(segments[:count]) for count in range(1, len(segments))]


def _header_path(header: bytes | bytearray) -> str:
    """GNU headers hold times where ustar holds the prefix: their path is the name field only."""
    name = _field(header, _NAME, keep_nul=False)
    is_gnu = _field(header, _GNU_MAGIC_FIELD, keep_nul=True) == _GNU_MAGIC_AND_VERSION
    prefix = b"" if is_gnu else _field(header, _PREFIX, keep_nul=False)

    return (prefix + b"/" + name if prefix else name).decode("utf-8", errors="replace")


def _field(header: bytes | bytearray, field: tuple[int, int], *, keep_nul: bool) -> bytes:
    text = bytes(header[field[0] : field[0] + field[1]])

    return text if keep_nul else text.split(b"\0", 1)[0]


def _octal(header: bytes | bytearray, field: tuple[int, int]) -> int | None:
    """Octal digits, with the leading and trailing spaces and NULs tar writers leave; base-256 sizes are refused."""
    digits = _field(header, field, keep_nul=True).strip(b" \0")

    return int(digits, 8) if _OCTAL.match(digits) else None


def _checksum(header: bytes | bytearray) -> int:
    """The byte sum with the checksum field read as eight spaces."""
    start, length = _CHECKSUM
    blanked = header[:start] + bytes([_CHECKSUM_SPACE]) * length + header[start + length :]

    return sum(blanked)
