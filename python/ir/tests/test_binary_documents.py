"""The binary's `generate` and `check` on an app config's OpenAPI documents, run through a stub that records its
arguments (ADR 0010, "Amendment 2026-11-01: the Python channels", Documents)."""

import hashlib
import sys
from collections.abc import Callable
from pathlib import Path

import pytest

from seampact.ir.binary import (
    BinaryFailureCode,
    BinaryRefusedError,
    DocumentsCommand,
    HostLibc,
    HostPlatform,
    InstalledBinary,
    documents_with_binary,
    install_compiler_binary,
)
from seampact.ir.binary.posix_cache_safety import PosixCacheSafety

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the stubs are shell scripts")

_HOST = HostPlatform("linux", "x86_64", HostLibc.GLIBC)


def _installed(
    tmp_path: Path, trusting_ancestors: Callable[[Path], PosixCacheSafety], body: str, exit_code: int = 0
) -> InstalledBinary:
    stub = tmp_path / "stub.sh"
    stub.write_text(f"#!/bin/sh\n{body}\nexit {exit_code}\n", encoding="utf-8")
    stub.chmod(0o755)
    sha256 = hashlib.sha256(stub.read_bytes()).hexdigest()
    (tmp_path / "pyproject.toml").write_text(f'[tool.seampact.binary]\npath = "stub.sh"\nsha256 = "{sha256}"\n')
    cache = tmp_path / "cache"
    environment = {"XDG_CACHE_HOME": str(cache)}

    return install_compiler_binary(str(tmp_path), _HOST, environment, trusting_ancestors(cache))


def test_the_command_arguments_and_handed_bundles_reach_the_binary(
    tmp_path: Path, trusting_ancestors: Callable[[Path], PosixCacheSafety]
) -> None:
    binary = _installed(tmp_path, trusting_ancestors, 'echo "$@"; echo "warning: careful" >&2')

    output = documents_with_binary(
        binary,
        str(tmp_path / "seampact.config.yaml"),
        DocumentsCommand.GENERATE_OVERWRITING_HAND_EDITS,
        {"zeta": str(tmp_path / "z"), "alpha": str(tmp_path / "a")},
        {},
        windows=False,
    )

    assert output.stdout.split() == [
        "generate", "--force", "--config", str(tmp_path / "seampact.config.yaml"),
        "--bundle-directory", f"alpha={tmp_path / 'a'}", "--bundle-directory", f"zeta={tmp_path / 'z'}",
    ]  # fmt: skip
    assert output.stderr.strip() == "warning: careful"


def test_a_refusal_of_the_binary_carries_its_diagnostics(
    tmp_path: Path, trusting_ancestors: Callable[[Path], PosixCacheSafety]
) -> None:
    binary = _installed(tmp_path, trusting_ancestors, "echo 'openapi.drift' >&2", exit_code=1)

    with pytest.raises(BinaryRefusedError) as refused:
        documents_with_binary(binary, str(tmp_path / "c.yaml"), DocumentsCommand.CHECK, {}, {}, windows=False)

    assert refused.value.failure.code is BinaryFailureCode.DOCUMENTS_REFUSED
    assert "openapi.drift" in refused.value.failure.message


def test_any_other_exit_is_a_failure_not_a_refusal(
    tmp_path: Path, trusting_ancestors: Callable[[Path], PosixCacheSafety]
) -> None:
    binary = _installed(tmp_path, trusting_ancestors, "echo boom >&2", exit_code=7)

    with pytest.raises(BinaryRefusedError) as refused:
        documents_with_binary(binary, str(tmp_path / "c.yaml"), DocumentsCommand.GENERATE, {}, {}, windows=False)

    assert refused.value.failure.code is BinaryFailureCode.COMPILE_FAILED
