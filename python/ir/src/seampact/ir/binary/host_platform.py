"""The host as Python reports it: `sys.platform`, `platform.machine()` and, on Linux, the C library. The table of ADR
0010 maps it to a release asset; any other row, musl and BSD included, is refused by name."""

import platform
import sys
from dataclasses import dataclass
from typing import Final

from seampact.ir.binary import release_assets
from seampact.ir.binary.failure import BinaryFailureCode, BinaryRefusedError
from seampact.ir.binary.host_libc import HostLibc, current_linux_libc

_LINUX: Final = "linux"
_WINDOWS: Final = "win32"

_ASSETS: Final = {
    (_LINUX, HostLibc.GLIBC, "x86_64"): release_assets.LINUX_X64,
    (_LINUX, HostLibc.GLIBC, "aarch64"): release_assets.LINUX_ARM64,
    ("darwin", HostLibc.NONE, "x86_64"): release_assets.DARWIN_X64,
    ("darwin", HostLibc.NONE, "arm64"): release_assets.DARWIN_ARM64,
    (_WINDOWS, HostLibc.NONE, "AMD64"): release_assets.WIN32_X64,
}


@dataclass(frozen=True, slots=True)
class HostPlatform:
    system: str
    machine: str
    libc: HostLibc

    @staticmethod
    def current() -> "HostPlatform":
        libc = current_linux_libc() if sys.platform == _LINUX else HostLibc.NONE

        return HostPlatform(sys.platform, platform.machine(), libc)

    @property
    def is_windows(self) -> bool:
        return self.system == _WINDOWS

    def asset_name(self) -> str:
        """Raises `binary.platform-unsupported`, naming the OS, arch and C library."""
        asset = _ASSETS.get((self.system, self.libc, self.machine))

        if asset is None:
            raise BinaryRefusedError(
                BinaryFailureCode.PLATFORM_UNSUPPORTED,
                f"The standalone compiler binary has no build for this host: sys.platform '{self.system}', "
                f"platform.machine() '{self.machine}', C library {self.libc.value}. It is built for Linux x86_64 "
                "and aarch64 (glibc), macOS x86_64 and arm64, and Windows AMD64.",
                "Use a bundle source, which needs no binary; or build on a glibc image such as `python:3.x-slim`; or "
                "point `[tool.seampact.binary] path` at your own build of the compiler, with its `sha256`.",
            )

        return asset
