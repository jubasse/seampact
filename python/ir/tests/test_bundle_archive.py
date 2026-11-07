"""The bundle tarball reader refuses a hostile archive by name: a pax length past the integer limit, a gzip bomb,
bytes after the gzip stream and too many entries (the PHP `BundleTarballTest` caps)."""

import gzip

from seampact.ir.bundle import BundleFailure, BundleFailureCode
from seampact.ir.bundle.archive import read_bundle_archive
from seampact.ir.bundle.layout import ENTRIES_MAX, EXTRACTED_BYTES_MAX

_BLOCK = 512


def _header(name: bytes, size: int, type_flag: bytes) -> bytes:
    header = bytearray(_BLOCK)
    header[0 : len(name)] = name
    header[100:108] = b"0000644\0"
    header[108:116] = b"0000000\0"
    header[116:124] = b"0000000\0"
    header[124:136] = f"{size:011o}".encode() + b"\0"
    header[136:148] = b"00000000000\0"
    header[148:156] = b" " * 8
    header[156:157] = type_flag
    header[257:265] = b"ustar\x0000"
    header[148:156] = f"{sum(header):06o}".encode() + b"\0 "

    return bytes(header)


def _padded(data: bytes) -> bytes:
    return data + b"\0" * (-len(data) % _BLOCK)


def _file_entries(name: str, data: bytes) -> bytes:
    return _header(name.encode(), len(data), b"0") + _padded(data)


def _tarball(entries: bytes) -> bytes:
    return gzip.compress(entries + b"\0" * (2 * _BLOCK))


def test_refuses_a_pax_length_of_thousands_of_digits() -> None:
    record = b"9" * 5000 + b" path=x\n"
    entries = _header(b"pax", len(record), b"x") + _padded(record) + _file_entries("sources/a.txt", b"a")

    result = read_bundle_archive(_tarball(entries))

    assert isinstance(result, BundleFailure)
    assert result.code is BundleFailureCode.ARCHIVE_INVALID


def test_reads_a_plain_archive() -> None:
    result = read_bundle_archive(_tarball(_file_entries("sources/a.txt", b"hello")))

    assert not isinstance(result, BundleFailure)
    assert result.read("sources/a.txt") == b"hello"


def test_refuses_a_gzip_bomb() -> None:
    bomb = gzip.compress(b"\0" * (EXTRACTED_BYTES_MAX + _BLOCK), compresslevel=9)

    result = read_bundle_archive(bomb)

    assert isinstance(result, BundleFailure)
    assert result.code is BundleFailureCode.ARCHIVE_EXTRACTED_TOO_LARGE


def test_refuses_bytes_after_the_gzip_stream() -> None:
    result = read_bundle_archive(_tarball(_file_entries("sources/a.txt", b"a")) + b"trailing")

    assert isinstance(result, BundleFailure)
    assert result.code is BundleFailureCode.ARCHIVE_INVALID


def test_refuses_more_entries_than_the_cap() -> None:
    entries = b"".join(_file_entries(f"sources/f{index}.txt", b"") for index in range(ENTRIES_MAX + 1))

    result = read_bundle_archive(_tarball(entries))

    assert isinstance(result, BundleFailure)
    assert result.code is BundleFailureCode.ARCHIVE_TOO_MANY_ENTRIES
