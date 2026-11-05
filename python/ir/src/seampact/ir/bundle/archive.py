"""The bundle tarball reader, with the standard library only. A tarball comes from the network, so it is inflated in
bounded steps into memory with the extracted cap checked as it grows, and never written to disk; bytes after the
gzip stream are refused. Every entry is checked (`UstarParser`) before the files are handed out."""

import zlib
from typing import Final

from seampact.ir.bundle.failure import BundleFailure, BundleFailureCode
from seampact.ir.bundle.files import BundleFiles
from seampact.ir.bundle.layout import ARCHIVE_BYTES_MAX, EXTRACTED_BYTES_MAX, NOT_A_BUNDLE_FIX
from seampact.ir.https.untrusted_text import quoted
from seampact.ir.bundle.ustar import UstarParser, archive_invalid

_GZIP_WINDOW_BITS: Final = 16 + zlib.MAX_WBITS
# Small input chunks bound the output of one inflate call, so the extracted cap is checked as it grows.
_INFLATE_CHUNK_BYTES: Final = 8 * 1024


def read_bundle_archive(tarball: bytes) -> BundleFiles | BundleFailure:
    """The files of a bundle tarball in archive order, or the failure that refuses it whole."""
    archive = _uncompressed(tarball)

    if isinstance(archive, BundleFailure):
        return archive

    entries = UstarParser(archive).parse()

    if isinstance(entries, BundleFailure):
        return entries

    sizes = {entry.path: entry.size for entry in entries}
    offsets = {entry.path: entry.offset for entry in entries}

    return BundleFiles(sizes, lambda path: bytes(archive[offsets[path] : offsets[path] + sizes[path]]))


def _uncompressed(tarball: bytes) -> bytearray | BundleFailure:
    if len(tarball) > ARCHIVE_BYTES_MAX:
        return BundleFailure(
            BundleFailureCode.ARCHIVE_TOO_LARGE,
            f"The tarball holds {len(tarball)} bytes, over the cap of {ARCHIVE_BYTES_MAX}.",
            NOT_A_BUNDLE_FIX,
            expected=str(ARCHIVE_BYTES_MAX),
            actual=str(len(tarball)),
        )

    inflater = zlib.decompressobj(_GZIP_WINDOW_BITS)
    output = bytearray()
    fed = 0

    try:
        while fed < len(tarball) and not inflater.eof:
            pending = tarball[fed : fed + _INFLATE_CHUNK_BYTES]
            fed += len(pending)

            while pending and not inflater.eof:
                output += inflater.decompress(pending, EXTRACTED_BYTES_MAX + 1 - len(output))

                if len(output) > EXTRACTED_BYTES_MAX:
                    return _extracted_too_large()

                pending = inflater.unconsumed_tail
    except zlib.error as error:
        return archive_invalid(f"it is not gzip data ({quoted(str(error))})")

    if not inflater.eof:
        return archive_invalid("the gzip data ends early")

    trailing = len(inflater.unused_data) + len(tarball) - fed

    if trailing:
        return archive_invalid(f"{trailing} bytes follow after the end of the gzip data")

    # Returned as is: a copy would hold the inflated archive twice.
    return output


def _extracted_too_large() -> BundleFailure:
    return BundleFailure(
        BundleFailureCode.ARCHIVE_EXTRACTED_TOO_LARGE,
        f"The tarball holds more than {EXTRACTED_BYTES_MAX} bytes once uncompressed.",
        NOT_A_BUNDLE_FIX,
        expected=str(EXTRACTED_BYTES_MAX),
    )
