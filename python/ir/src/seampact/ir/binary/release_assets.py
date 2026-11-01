"""The binary contract's release assets: one binary per platform and the manifest of their SHA-256 hashes, the names
of `packages/tools/binary/scripts/binary-names.mjs`."""

import re
from typing import Final, TypeGuard

LINUX_X64: Final = "seampact-linux-x64"
LINUX_ARM64: Final = "seampact-linux-arm64"
DARWIN_X64: Final = "seampact-darwin-x64"
DARWIN_ARM64: Final = "seampact-darwin-arm64"
WIN32_X64: Final = "seampact-win32-x64.exe"

BINARIES: Final = (LINUX_X64, LINUX_ARM64, DARWIN_X64, DARWIN_ARM64, WIN32_X64)
MANIFEST: Final = "SHA256SUMS"

_SHA256_PATTERN: Final = re.compile(r"[0-9a-f]{64}\Z")


def is_sha256(value: object) -> TypeGuard[str]:
    return isinstance(value, str) and _SHA256_PATTERN.match(value) is not None
