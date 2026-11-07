"""The compatibility read of the Python entries against the shipped copy of the matrix's `pythonTargets`."""

import json
from pathlib import Path

import pytest

from seampact.ir.config import ConfigProblem, read_app_config
from seampact.ir.config.app_config import AppConfig
from seampact.ir.run.matrix_check import check_matrix
from seampact.ir.run.matrix_framework import python_targets

_FASTAPI = "pypi:seampact-fastapi"
_DRF = "pypi:seampact-drf"


def _config(
    tmp_path: Path, allow_untested: list[str] | None = None, checks: str = "", use: str = _FASTAPI
) -> AppConfig:
    file = tmp_path / "seampact.config.yaml"
    allowed = "" if allow_untested is None else f", allowUntested: [{', '.join(allow_untested)}]"
    file.write_text(f"{checks}targets:\n  - {{ id: main, use: '{use}', api: tasks{allowed} }}\n", encoding="utf-8")
    config = read_app_config(str(file))
    assert not isinstance(config, list), config

    return config


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


def test_a_minor_outside_the_tested_minors_of_a_tested_major_follows_the_matrix_check_level(tmp_path: Path) -> None:
    tested_minor = {"djangorestframework": "3.18.0", "django": "6.1.2"}
    untested_minor = {"djangorestframework": "3.18.0", "django": "6.0.4"}
    default_level = _config(tmp_path, use=_DRF)
    error_level = _config(tmp_path, checks="checks: { matrix: error }\n", use=_DRF)

    warned = check_matrix(default_level, untested_minor)
    refused = check_matrix(error_level, untested_minor)

    assert check_matrix(error_level, tested_minor) == ([], [])
    assert (warned[0], _codes(warned[1])) == ([], ["config.matrix.untested-minor"])
    assert (_codes(refused[0]), refused[1]) == (["config.matrix.untested-minor"], [])
    assert "django 5.2, 6.1 only" in refused[0][0].message


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
    assert json.dumps(sorted(python_targets())) == json.dumps(["pypi:seampact-drf", _FASTAPI, "pypi:seampact-ninja"])


@pytest.mark.parametrize("item", ["fastapi@0.162", "fastapi@0.0", "starlette@1"])
def test_an_allow_untested_item_is_a_major_or_a_zero_dot_minor(tmp_path: Path, item: str) -> None:
    assert not isinstance(_read_allowing(tmp_path, item), list)


@pytest.mark.parametrize("item", ["starlette@1.4", "starlette@0", "fastapi@0.01", "fastapi@0.", "fastapi"])
def test_any_other_allow_untested_item_is_refused_by_name_with_its_fix(tmp_path: Path, item: str) -> None:
    result = _read_allowing(tmp_path, item)

    assert isinstance(result, list)
    assert [problem.code for problem in result] == ["config.schema"]
    assert result[0].message.startswith("An `allowUntested` item is")
    assert "'fastapi@0.162'" in result[0].fix


def _read_allowing(tmp_path: Path, item: str) -> AppConfig | list[ConfigProblem]:
    file = tmp_path / "seampact.config.yaml"
    file.write_text(
        f"targets:\n  - {{ id: main, use: '{_FASTAPI}', api: tasks, allowUntested: ['{item}'] }}\n", encoding="utf-8"
    )

    return read_app_config(str(file))
