"""The platform table of ADR 0010 "The Python channels": every OS, arch and libc row to a
release asset, or the refusal that names the detected values."""

import pytest

from seampact.ir.binary import BinaryFailureCode, BinaryRefusedError, HostLibc, HostPlatform
from seampact.ir.binary.host_libc import linux_libc

_SUPPORTED = [
    ("linux", "x86_64", HostLibc.GLIBC, "seampact-linux-x64"),
    ("linux", "aarch64", HostLibc.GLIBC, "seampact-linux-arm64"),
    ("darwin", "x86_64", HostLibc.NONE, "seampact-darwin-x64"),
    ("darwin", "arm64", HostLibc.NONE, "seampact-darwin-arm64"),
    ("win32", "AMD64", HostLibc.NONE, "seampact-win32-x64.exe"),
]

_REFUSED = [
    ("linux", "x86_64", HostLibc.MUSL),
    ("linux", "aarch64", HostLibc.MUSL),
    ("linux", "x86_64", HostLibc.UNKNOWN),
    ("linux", "i686", HostLibc.GLIBC),
    ("linux", "riscv64", HostLibc.GLIBC),
    ("darwin", "aarch64", HostLibc.NONE),
    ("win32", "ARM64", HostLibc.NONE),
    ("win32", "x86", HostLibc.NONE),
    ("freebsd14", "amd64", HostLibc.NONE),
    ("openbsd7", "amd64", HostLibc.NONE),
]


@pytest.mark.parametrize(("system", "machine", "libc", "asset"), _SUPPORTED)
def test_maps_a_supported_row_to_its_asset(system: str, machine: str, libc: HostLibc, asset: str) -> None:
    assert HostPlatform(system, machine, libc).asset_name() == asset


@pytest.mark.parametrize(("system", "machine", "libc"), _REFUSED)
def test_refuses_any_other_row_naming_what_it_detected(system: str, machine: str, libc: HostLibc) -> None:
    with pytest.raises(BinaryRefusedError) as refused:
        HostPlatform(system, machine, libc).asset_name()

    failure = refused.value.failure
    assert failure.code is BinaryFailureCode.PLATFORM_UNSUPPORTED
    assert system in failure.message
    assert machine in failure.message
    assert f"C library {libc.value}" in failure.message
    assert "bundle source" in failure.fix
    assert "glibc image" in failure.fix
    assert "path" in failure.fix


def test_a_windows_host_is_told_apart() -> None:
    assert HostPlatform("win32", "AMD64", HostLibc.NONE).is_windows
    assert not HostPlatform("darwin", "arm64", HostLibc.NONE).is_windows


@pytest.mark.parametrize(
    ("glibc_version", "library_entries", "libc"),
    [
        ("glibc 2.39", [], HostLibc.GLIBC),
        ("glibc 2.39", ["ld-musl-x86_64.so.1"], HostLibc.GLIBC),
        (None, ["ld-musl-x86_64.so.1", "libc.musl-x86_64.so.1"], HostLibc.MUSL),
        (None, ["ld-musl-aarch64.so.1"], HostLibc.MUSL),
        (None, ["ld-linux-x86-64.so.2"], HostLibc.UNKNOWN),
        (None, [], HostLibc.UNKNOWN),
    ],
)
def test_reads_the_linux_libc_from_the_glibc_answer_then_the_loader(
    glibc_version: str | None, library_entries: list[str], libc: HostLibc
) -> None:
    assert linux_libc(glibc_version, library_entries) is libc
