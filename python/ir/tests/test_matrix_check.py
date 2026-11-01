"""The compatibility read of the Python entries against the shipped copy of the matrix's `pythonTargets`."""

import json
from dataclasses import replace
from pathlib import Path

from seampact.ir.config import ConfigProblem, read_app_config
from seampact.ir.config.app_config import AppConfig, AppConfigEntry
from seampact.ir.run.matrix_check import check_matrix
from seampact.ir.run.matrix_framework import python_targets

_FASTAPI = "pypi:seampact-fastapi"


def _config(tmp_path: Path, allow_untested: list[str] | None = None, checks: str = "") -> AppConfig:
    """The config schema's `allowUntested` pattern takes a major only; the 0.x minor items are set after the read."""
    file = tmp_path / "seampact.config.yaml"
    file.write_text(f"{checks}targets:\n  - {{ id: main, use: '{_FASTAPI}', api: tasks }}\n", encoding="utf-8")
    config = read_app_config(str(file))
    assert not isinstance(config, list), config

    if allow_untested is None:
        return config

    entry = AppConfigEntry({**config.entries[0].entry, "allowUntested": list(allow_untested)}, config.entries[0].root)

    return replace(config, entries=[entry])


def _codes(problems: list[ConfigProblem]) -> list[str]:
    return [problem.code for problem in problems]


def test_the_shipped_matrix_is_an_exact_copy_of_the_spec(repository_root: Path) -> None:
    spec = repository_root / "packages/core/spec/compatibility/python-targets.json"
    copy = Path(__file__).parents[1] / "src/seampact/ir/compatibility/python-targets.json"

    assert copy.read_bytes() == spec.read_bytes(), "Copy packages/core/spec/compatibility/python-targets.json again."


def test_fastapi_is_checked_by_minor_and_starlette_by_major(tmp_path: Path) -> None:
    target = python_targets()[_FASTAPI]

    assert [(item.id, item.unit.value) for item in target.frameworks] == [("fastapi", "minor"), ("starlette", "major")]


def test_the_tested_versions_pass(tmp_path: Path) -> None:
    problems, warnings = check_matrix(_config(tmp_path), {"fastapi": "0.162.3", "starlette": "0.46.2"})

    assert (problems, warnings) == ([], [])


def test_a_newer_fastapi_minor_is_untested_and_allow_untested_names_its_minor(tmp_path: Path) -> None:
    installed = {"fastapi": "0.163.0", "starlette": "1.4.0"}

    problems, warnings = check_matrix(_config(tmp_path), installed)
    allowed = check_matrix(_config(tmp_path, ["fastapi@0.163"]), installed)

    assert (problems, _codes(warnings)) == ([], ["config.matrix.untested"])
    assert allowed == ([], [])
    assert "allowUntested: [fastapi@0.163]" in warnings[0].fix


def test_an_untested_version_is_an_error_at_the_error_level(tmp_path: Path) -> None:
    problems, _ = check_matrix(
        _config(tmp_path, checks="checks: { matrix: error }\n"), {"fastapi": "0.163.0", "starlette": "0.46.0"}
    )

    assert _codes(problems) == ["config.matrix.untested"]


def test_a_version_below_the_floor_is_always_refused(tmp_path: Path) -> None:
    problems, _ = check_matrix(_config(tmp_path), {"fastapi": "0.161.0", "starlette": "0.45.0"})

    assert _codes(problems) == ["config.matrix.incompatible", "config.matrix.incompatible"]


def test_a_framework_that_is_not_installed_is_named(tmp_path: Path) -> None:
    problems, _ = check_matrix(_config(tmp_path), {"fastapi": "0.162.0"})

    assert _codes(problems) == ["framework.version.unresolved"]
    assert "starlette" in problems[0].message


def test_an_allow_untested_item_of_another_framework_or_a_tested_unit_is_reported(tmp_path: Path) -> None:
    installed = {"fastapi": "0.162.0", "starlette": "0.46.0"}

    foreign, _ = check_matrix(_config(tmp_path, ["django@5"]), installed)
    _, useless = check_matrix(_config(tmp_path, ["fastapi@0.162"]), installed)

    assert _codes(foreign) == ["config.matrix.unknown-framework"]
    assert _codes(useless) == ["config.matrix.allowed-tested"]


def test_an_entry_of_a_target_the_matrix_does_not_record_is_not_checked(tmp_path: Path) -> None:
    file = tmp_path / "seampact.config.yaml"
    file.write_text("targets:\n  - { id: main, use: 'pypi:acme', api: tasks }\n", encoding="utf-8")
    config = read_app_config(str(file))
    assert not isinstance(config, list)

    assert check_matrix(config, {}) == ([], [])


def test_the_spec_row_names_the_use_the_config_schema_accepts() -> None:
    assert json.dumps(sorted(python_targets())) == json.dumps([_FASTAPI])
