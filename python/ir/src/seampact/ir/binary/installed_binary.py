"""The private, content-addressed copy of the binary, the only file seampact runs, and the checks it passes. Its path
is below the real path of the cache root, so the file checked is the file started."""

import hashlib
from dataclasses import dataclass

from seampact.ir.binary.cache_safety import CacheSafety
from seampact.ir.binary.failure import BinaryFailureCode, BinaryRefusedError


@dataclass(frozen=True, slots=True)
class InstalledBinary:
    path: str
    sha256: str
    cache_root: str
    safety: CacheSafety

    def refuse_unless_intact(self) -> None:
        """Runs the cache checks and hashes the copy again, right before a start. Raises `binary.cache-unsafe` or
        `binary.hash-mismatch`."""
        self.safety.refuse_unsafe(self.path, self.cache_root)

        try:
            with open(self.path, "rb") as handle:
                actual = hashlib.file_digest(handle, "sha256").hexdigest()
        except OSError as error:
            raise hash_mismatch(self.path, self.sha256, f"unreadable ({error})") from error

        if actual != self.sha256:
            raise hash_mismatch(self.path, self.sha256, actual)


def hash_mismatch(file: str, expected: str, actual: str) -> BinaryRefusedError:
    return BinaryRefusedError(
        BinaryFailureCode.HASH_MISMATCH,
        f"The compiler binary '{file}' has the SHA-256 {actual}; the pin is {expected}. It is never run.",
        "Point the override at the build the pin names, or pin the SHA-256 of your own build after you review it.",
    )
