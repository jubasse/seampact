"""The refusals of the compiler binary channel of a Python build (ADR 0010, "Amendment 2026-11-01: the Python
channels"): the codes are those of the PHP and JVM channels."""

from dataclasses import dataclass
from enum import StrEnum


class BinaryFailureCode(StrEnum):
    UNPUBLISHED = "binary.unpublished"
    PIN_MISSING = "binary.pin-missing"
    PIN_INVALID = "binary.pin-invalid"
    HASH_MISMATCH = "binary.hash-mismatch"
    OVERRIDE_NOT_ROOT = "binary.override-not-root"
    PLATFORM_UNSUPPORTED = "binary.platform-unsupported"
    CACHE_UNAVAILABLE = "binary.cache-unavailable"
    CACHE_UNSAFE = "binary.cache-unsafe"
    COMPILE_REFUSED = "binary.compile-refused"
    COMPILE_TIMEOUT = "binary.compile-timeout"
    COMPILE_FAILED = "binary.compile-failed"
    DOCUMENTS_REFUSED = "binary.documents-refused"


@dataclass(frozen=True, slots=True)
class BinaryFailure:
    """Why the compiler binary is not run: the code, what was found, and the fix."""

    code: BinaryFailureCode
    message: str
    fix: str


class BinaryRefusedError(Exception):
    """The compiler binary is refused before or while it runs; `failure` names the code and the fix."""

    def __init__(self, code: BinaryFailureCode, message: str, fix: str) -> None:
        super().__init__(f"{code.value}: {message} {fix}")
        self.failure = BinaryFailure(code, message, fix)
