"""The pin decides whether the binary ever starts (ADR 0010, "The Python channels"): a stub
with the wrong hash never starts, proved by a marker file it would have touched."""

import hashlib
import sys
from collections.abc import Callable, Mapping
from pathlib import Path

import pytest

from seampact.ir.binary import (
    BinaryFailureCode,
    BinaryRefusedError,
    HostLibc,
    HostPlatform,
    InstalledBinary,
    compile_with_binary,
    install_compiler_binary,
)
from seampact.ir.binary.posix_cache_safety import PosixCacheSafety

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the stubs are shell scripts")

_HOST = HostPlatform("linux", "x86_64", HostLibc.GLIBC)
_WRONG_HASH = "0" * 64


def stub_compiler(file: Path, marker: Path, apis: list[str], body: str = "", exit_code: int = 0) -> str:
    """Writes a shell script that touches `marker`, then writes `{}` as the IR of each api, and returns its SHA-256."""
    writes = "".join(f'echo "{{}}" > "$5/{api}.ir.json"\n' for api in apis)
    file.write_text(f'#!/bin/sh\ntouch "{marker}"\n{body}\n{writes}exit {exit_code}\n', encoding="utf-8")
    file.chmod(0o755)

    return hashlib.sha256(file.read_bytes()).hexdigest()


class _Project:
    def __init__(self, directory: Path, trusting_ancestors: Callable[[Path], PosixCacheSafety]) -> None:
        self._trusting_ancestors = trusting_ancestors
        self.directory = directory
        self.cache = directory / "cache"
        self.marker = directory / "started"
        self.stub = directory / "stub.sh"
        self.environment: Mapping[str, str] = {"XDG_CACHE_HOME": str(self.cache)}

    def pyproject(self, table: str) -> None:
        (self.directory / "pyproject.toml").write_text(f"[project]\nname = 'app'\n{table}", encoding="utf-8")

    def pin_stub(self, sha256: str) -> None:
        self.pyproject(f'[tool.seampact.binary]\npath = "stub.sh"\nsha256 = "{sha256}"\n')

    def install(self) -> InstalledBinary:
        return install_compiler_binary(
            str(self.directory), _HOST, self.environment, self._trusting_ancestors(self.cache)
        )


@pytest.fixture
def project(tmp_path: Path, trusting_ancestors: Callable[[Path], PosixCacheSafety]) -> _Project:
    return _Project(tmp_path, trusting_ancestors)


def _refusal(action: object) -> BinaryRefusedError:
    with pytest.raises(BinaryRefusedError) as refused:
        action()  # type: ignore[operator]

    return refused.value


def test_a_stub_with_the_wrong_hash_never_starts(project: _Project) -> None:
    stub_compiler(project.stub, project.marker, ["shop"])
    project.pin_stub(_WRONG_HASH)

    failure = _refusal(project.install).failure

    assert failure.code is BinaryFailureCode.HASH_MISMATCH
    assert _WRONG_HASH in failure.message
    assert not project.marker.exists()
    assert not project.cache.exists()


def test_a_copy_changed_in_the_cache_never_starts(project: _Project) -> None:
    sha256 = stub_compiler(project.stub, project.marker, ["shop"])
    project.pin_stub(sha256)
    installed = project.install()
    Path(installed.path).write_text("#!/bin/sh\ntouch started\n", encoding="utf-8")

    failure = _refusal(
        lambda: compile_with_binary(installed, str(project.directory / "app.yaml"), ["shop"], {}, windows=False)
    ).failure

    assert failure.code is BinaryFailureCode.HASH_MISMATCH
    assert not project.marker.exists()


def test_runs_only_the_private_copy_with_the_contract_environment(project: _Project) -> None:
    sha256 = stub_compiler(project.stub, project.marker, ["shop", "admin"], body="env >&2")
    project.pin_stub(sha256)
    installed = project.install()

    output = compile_with_binary(
        installed,
        str(project.directory / "app.yaml"),
        ["shop", "admin"],
        {"SECRET": "leaked", "TMPDIR": str(project.directory), "NODE_OPTIONS": "--require x"},
        windows=False,
    )

    assert project.marker.exists()
    assert installed.path.startswith(str(project.cache.resolve()))
    assert installed.path != str(project.stub)
    assert output.ir_text_by_api == {"shop": "{}\n", "admin": "{}\n"}
    assert f"TMPDIR={project.directory}" in output.diagnostics
    assert "SECRET" not in output.diagnostics
    assert "NODE_OPTIONS" not in output.diagnostics


def test_a_refused_compile_carries_the_diagnostics(project: _Project) -> None:
    sha256 = stub_compiler(project.stub, project.marker, [], body="echo 'config.bad \x1b[31mred' >&2", exit_code=1)
    project.pin_stub(sha256)

    failure = _refusal(
        lambda: compile_with_binary(project.install(), str(project.directory / "app.yaml"), [], {}, windows=False)
    ).failure

    assert failure.code is BinaryFailureCode.COMPILE_REFUSED
    assert "config.bad [31mred" in failure.message


def test_a_compile_with_no_ir_for_an_api_fails(project: _Project) -> None:
    sha256 = stub_compiler(project.stub, project.marker, ["shop"])
    project.pin_stub(sha256)

    failure = _refusal(
        lambda: compile_with_binary(
            project.install(), str(project.directory / "app.yaml"), ["admin"], {}, windows=False
        )
    ).failure

    assert failure.code is BinaryFailureCode.COMPILE_FAILED
    assert "'admin'" in failure.message


def test_a_compile_past_its_deadline_is_stopped(project: _Project) -> None:
    sha256 = stub_compiler(project.stub, project.marker, [], body="exec sleep 30")
    project.pin_stub(sha256)

    failure = _refusal(
        lambda: compile_with_binary(
            project.install(), str(project.directory / "app.yaml"), [], {}, windows=False, timeout_seconds=0.5
        )
    ).failure

    assert failure.code is BinaryFailureCode.COMPILE_TIMEOUT


@pytest.mark.parametrize(
    ("table", "code", "fragment"),
    [
        ('path = "stub.sh"\n', BinaryFailureCode.PIN_MISSING, "no `sha256`"),
        (f'path = "stub.sh"\nsha256 = "{"A" * 64}"\n', BinaryFailureCode.PIN_INVALID, "64 lowercase hexadecimal"),
        (f'path = "stub.sh"\nsha256 = "{_WRONG_HASH}"\nextra = 1\n', BinaryFailureCode.PIN_INVALID, "unknown key"),
        (f'sha256 = "{_WRONG_HASH}"\n', BinaryFailureCode.PIN_INVALID, "exactly one"),
        (f'path = "a"\nurl = "https://x"\nsha256 = "{_WRONG_HASH}"\n', BinaryFailureCode.PIN_INVALID, "exactly one"),
        ('version = "1.0.0"\nsha256 = {}\n', BinaryFailureCode.PIN_MISSING, "no hash for"),
        (
            f'version = "1.0.0"\n[tool.seampact.binary.sha256]\nmystery = "{_WRONG_HASH}"\n',
            BinaryFailureCode.PIN_INVALID,
            "no release binary",
        ),
    ],
)
def test_an_override_without_a_valid_pin_is_refused(
    project: _Project, table: str, code: BinaryFailureCode, fragment: str
) -> None:
    stub_compiler(project.stub, project.marker, [])
    project.pyproject(f"[tool.seampact.binary]\n{table}")

    failure = _refusal(project.install).failure

    assert failure.code is code
    assert fragment in failure.message
    assert not project.marker.exists()


def test_no_override_and_no_published_pin_names_the_path_override(project: _Project) -> None:
    project.pyproject("")

    failure = _refusal(project.install).failure

    assert failure.code is BinaryFailureCode.UNPUBLISHED
    assert "[tool.seampact.binary]" in failure.fix


def test_a_workspace_member_cannot_set_the_override(project: _Project) -> None:
    member = project.directory / "libs" / "plugin"
    member.mkdir(parents=True)
    (member / "pyproject.toml").write_text(
        f'[project]\nname = "plugin"\n[tool.seampact.binary]\npath = "x"\nsha256 = "{_WRONG_HASH}"\n', encoding="utf-8"
    )
    project.pyproject('[tool.uv.workspace]\nmembers = ["libs/*"]\n')

    failure = _refusal(project.install).failure

    assert failure.code is BinaryFailureCode.OVERRIDE_NOT_ROOT
    assert str(member / "pyproject.toml") in failure.message


def test_an_unsafe_cache_is_refused_before_the_copy_runs(project: _Project) -> None:
    sha256 = stub_compiler(project.stub, project.marker, ["shop"])
    project.pin_stub(sha256)
    installed = project.install()
    Path(installed.path).parent.chmod(0o770)

    failure = _refusal(
        lambda: compile_with_binary(installed, str(project.directory / "app.yaml"), ["shop"], {}, windows=False)
    ).failure

    assert failure.code is BinaryFailureCode.CACHE_UNSAFE
    assert "chmod 700" in failure.fix
    assert not project.marker.exists()
