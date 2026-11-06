"""The Python server targets write the same bytes on every run, whatever the hash seed, time zone and locale: the
files a team commits and drift-checks."""

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Final

import pytest

_SCRIPT: Final = Path(__file__).parent / "generated_tree.py"
_TARGETS: Final = ("fastapi", "drf", "ninja")
_APIS: Final = ("tasks", "tasksService")
_ENVIRONMENTS: Final = (
    {"PYTHONHASHSEED": "1", "TZ": "UTC", "LANG": "C", "LC_ALL": "C"},
    {"PYTHONHASHSEED": "2", "TZ": "Pacific/Kiritimati", "LANG": "tr_TR.UTF-8", "LC_ALL": "tr_TR.UTF-8"},
)


def _generated_tree_text(
    target: str, api: str, repository_root: Path, environment: dict[str, str], copy: str | None = None
) -> str:
    run = subprocess.run(
        [sys.executable, str(_SCRIPT), target, str(repository_root), api, *([copy] if copy else [])],
        env={**os.environ, **environment},
        capture_output=True,
        text=True,
        check=False,
    )

    assert run.returncode == 0, run.stderr

    return run.stdout


@pytest.mark.parametrize("api", _APIS)
@pytest.mark.parametrize("target", _TARGETS)
def test_a_target_writes_the_same_bytes_under_another_hash_seed_time_zone_and_locale(
    repository_root: Path, target: str, api: str
) -> None:
    runs = [_generated_tree_text(target, api, repository_root, environment) for environment in _ENVIRONMENTS]

    assert "operations.py" in json.loads(runs[0])
    assert runs[1] == runs[0]


@pytest.mark.parametrize("copy", ["crlf", "reordered"])
@pytest.mark.parametrize("target", _TARGETS)
def test_a_target_writes_the_same_bytes_from_a_crlf_or_reordered_copy_of_the_contract(
    repository_root: Path, target: str, copy: str
) -> None:
    environment = _ENVIRONMENTS[0]
    original = _generated_tree_text(target, "tasks", repository_root, environment)

    assert _generated_tree_text(target, "tasks", repository_root, environment, copy) == original
