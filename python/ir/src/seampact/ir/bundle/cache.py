"""The bundle cache, by integrity value (ADR 0011 "Channels"), under `<cache root>/bundles/`. An entry is written
through a private temporary directory and a rename, so a reader never sees half of one, and the pinned-bundle check
runs again on every read: the cache is a copy, never a trust input. As `cache.ts`."""

import base64
import binascii
import os
import re
import shutil
import tempfile
from typing import Final

from seampact.ir.bundle.files import BundleFiles

_BUNDLES_DIRECTORY: Final = "bundles"
_TEMPORARY_PREFIX: Final = ".incoming-"
_INTEGRITY_PREFIX: Final = "sha256-"
# A SHA-256 digest as `sha256-` and its padded standard base64.
_SHA256_INTEGRITY: Final = re.compile(r"sha256-[A-Za-z0-9+/]{43}=\Z")
_OWNER_ONLY: Final = 0o700


class BundleCache:
    def __init__(self, directory: str) -> None:
        self._directory = directory

    def entry_of(self, integrity: str) -> str | None:
        """The entry directory of `integrity`, or None when the value is not a SHA-256 one."""
        if not _SHA256_INTEGRITY.match(integrity):
            return None

        try:
            digest = base64.b64decode(integrity[len(_INTEGRITY_PREFIX) :], validate=True)
        except binascii.Error:
            return None

        return os.path.join(self._bundles_directory, f"{_INTEGRITY_PREFIX}{digest.hex()}")

    def store(self, files: BundleFiles, entry: str) -> None:
        """Writes the checked bundle `files` to `entry`; an entry another run wrote first is kept."""
        if os.path.lexists(entry):
            return

        parent = self._bundles_directory
        os.makedirs(parent, mode=_OWNER_ONLY, exist_ok=True)
        incoming = tempfile.mkdtemp(prefix=_TEMPORARY_PREFIX, dir=parent)

        try:
            for path in files.sizes:
                target = os.path.join(incoming, *path.split("/"))
                os.makedirs(os.path.dirname(target), mode=_OWNER_ONLY, exist_ok=True)

                with open(target, "wb") as handle:
                    handle.write(files.read(path))

            os.rename(incoming, entry)
        except OSError as error:
            shutil.rmtree(incoming, ignore_errors=True)

            if not os.path.lexists(entry):
                raise OSError(
                    f"seampact-ir: storing the cache entry '{entry}' failed ({error}); check that the cache "
                    "directory is writable."
                ) from error

    @property
    def _bundles_directory(self) -> str:
        return os.path.join(self._directory, _BUNDLES_DIRECTORY)
