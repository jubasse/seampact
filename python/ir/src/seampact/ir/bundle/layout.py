"""The bundle layout and the caps every reader applies: a bundle comes from the network, so a bundle one reader
refuses for size, every reader refuses."""

from typing import Final

MANIFEST_FILE: Final = "seampact-bundle.json"
SOURCES_DIRECTORY: Final = "sources"
IR_DIRECTORY: Final = "ir"

_MEBIBYTE: Final = 1024 * 1024

# A tarball's compressed bytes.
ARCHIVE_BYTES_MAX: Final = 64 * _MEBIBYTE
# A tarball's uncompressed bytes, and the sum of a bundle directory's file sizes.
EXTRACTED_BYTES_MAX: Final = 256 * _MEBIBYTE
# The entries of a tarball, and the files of a bundle directory.
ENTRIES_MAX: Final = 10_000
MANIFEST_BYTES_MAX: Final = _MEBIBYTE

REFETCH_FIX: Final = "Fetch the bundle again from its source; if it fails again, the source holds a tampered bundle."
NOT_A_BUNDLE_FIX: Final = "Check that the source names a seampact bundle; a bundle this large is not one."
REBUILD_FIX: Final = "Download the bundle again, or rebuild it with `seampact bundle`."
