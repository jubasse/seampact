"""The ninja target on the reference contract, against its golden packages (sync views, and async views for
`tasksService`), which ruff, `mypy --strict` with the Pydantic plugin and the Django stubs, and pyright strict check as
the generated code of an app. Set `SEAMPACT_UPDATE_GOLDEN=1` to write them again."""

import os
from collections.abc import Mapping
from pathlib import Path

import pytest

from seampact.ir.config.json_value import JsonValue
from seampact.ir.read import read_ir
from seampact.ir.run.generator import TargetEntry
from seampact.ir.run.matrix_framework import python_targets
from seampact.ninja.generator import NinjaGenerator

_GOLDEN = Path(__file__).parent / "golden" / "reference"
_UPDATE = os.environ.get("SEAMPACT_UPDATE_GOLDEN") == "1"


def reference_entry(
    api: str, options: Mapping[str, JsonValue] | None = None, artefacts: Mapping[str, JsonValue] | None = None
) -> TargetEntry:
    return TargetEntry(
        id="reference",
        use="pypi:seampact-ninja",
        api=api,
        document=None,
        options=options or {},
        artefacts=artefacts or {},
        output_directory="/app/generated",
        framework_routes=[],
        mount=None,
        matrix=python_targets()["pypi:seampact-ninja"],
        allow_untested=(),
    )


@pytest.mark.parametrize(
    ("api", "package", "views"), [("tasks", "tasks", "sync"), ("tasksService", "tasks_service", "async")]
)
def test_the_reference_contract_matches_its_golden_package(
    repository_root: Path, api: str, package: str, views: str
) -> None:
    generator = NinjaGenerator()
    text = (repository_root / f"fixtures/golden/reference/{api}.ir.json").read_text(encoding="utf-8")
    files = generator.generate(read_ir(text, generator.ir_support()), reference_entry(api, {"views": views}))

    assert [file.path for file in files] == [
        "__init__.py",
        "contract.py",
        "django.py",
        "ninja.py",
        "operations.py",
        "routes.py",
        "schemas.py",
    ]

    for file in files:
        path = _GOLDEN / package / file.path

        if _UPDATE:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(file.contents, encoding="utf-8")

        assert file.contents == path.read_text(encoding="utf-8"), f"{path} differs; run with SEAMPACT_UPDATE_GOLDEN=1"
