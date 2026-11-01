"""The real compiler binary through the runner: the IR it writes is byte-identical to `fixtures/golden`. It runs
only when `SEAMPACT_BINARY` names a binary built for this host (the CI job builds the linux-x64 one)."""

import hashlib
import os
import shutil
import sys
from collections.abc import Callable
from pathlib import Path

import pytest

from seampact.ir.binary import HostPlatform, compile_with_binary, install_compiler_binary
from seampact.ir.binary.posix_cache_safety import PosixCacheSafety
from seampact.ir.read import IrSupport, read_ir

_BINARY_VARIABLE = "SEAMPACT_BINARY"
_APIS = ["tasks", "tasksService"]
_APP_CONFIG = """\
outDir: src/Generated
sources:
  contract: { path: contract }
targets:
  - id: tasks
    out: Tasks
    use: 'pypi:seampact-fastapi'
    api: tasks
"""

pytestmark = [
    pytest.mark.skipif(sys.platform == "win32", reason="the cache rule of Windows reads an ACL"),
    pytest.mark.skipif(_BINARY_VARIABLE not in os.environ, reason=f"{_BINARY_VARIABLE} names no binary"),
]


def test_the_compiled_ir_is_byte_identical_to_the_golden_files(
    repository_root: Path, tmp_path: Path, trusting_ancestors: Callable[[Path], PosixCacheSafety]
) -> None:
    binary = Path(os.environ[_BINARY_VARIABLE]).resolve()
    application = tmp_path / "app"
    shutil.copytree(repository_root / "fixtures/reference", application / "contract")
    (application / "seampact.config.yaml").write_text(_APP_CONFIG, encoding="utf-8")
    sha256 = hashlib.sha256(binary.read_bytes()).hexdigest()
    (application / "pyproject.toml").write_text(
        f'[project]\nname = "app"\n[tool.seampact.binary]\npath = "{binary}"\nsha256 = "{sha256}"\n', encoding="utf-8"
    )
    cache = tmp_path / "cache"
    installed = install_compiler_binary(
        str(application), HostPlatform.current(), {"XDG_CACHE_HOME": str(cache)}, trusting_ancestors(cache)
    )

    output = compile_with_binary(
        installed,
        str(application / "seampact.config.yaml"),
        _APIS,
        {"TMPDIR": str(tmp_path)},
        windows=False,
    )

    assert installed.path != str(binary)
    for api in _APIS:
        golden = (repository_root / f"fixtures/golden/reference/{api}.ir.json").read_bytes()

        assert output.ir_text_by_api[api].encode("utf-8") == golden
        assert read_ir(output.ir_text_by_api[api], IrSupport.of_model(kinds=["httpOperation"])).api.id == api
