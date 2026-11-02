"""The fastapi target on the reference contract, against its golden package, which ruff, `mypy --strict` with the
Pydantic plugin and pyright strict check as the generated code of an app. Set `SEAMPACT_UPDATE_GOLDEN=1` to write it
again."""

import os
from collections.abc import Mapping
from pathlib import Path

import pytest

from seampact.fastapi.generator import FastApiGenerator
from seampact.ir.config.json_value import JsonValue
from seampact.ir.read import read_ir
from seampact.ir.run.generator import TargetEntry

_GOLDEN = Path(__file__).parent / "golden" / "reference"
_UPDATE = os.environ.get("SEAMPACT_UPDATE_GOLDEN") == "1"


def reference_entry(
    api: str, options: Mapping[str, JsonValue] | None = None, artefacts: Mapping[str, JsonValue] | None = None
) -> TargetEntry:
    return TargetEntry(
        id="reference",
        use="pypi:seampact-fastapi",
        api=api,
        document=None,
        options=options or {},
        artefacts=artefacts or {},
        output_directory="/app/generated",
        framework_routes=[],
        mount=None,
        matrix=None,
        allow_untested=(),
    )


@pytest.mark.parametrize(("api", "package"), [("tasks", "tasks"), ("tasksService", "tasks_service")])
def test_the_reference_contract_matches_its_golden_package(repository_root: Path, api: str, package: str) -> None:
    generator = FastApiGenerator()
    text = (repository_root / f"fixtures/golden/reference/{api}.ir.json").read_text(encoding="utf-8")
    files = generator.generate(read_ir(text, generator.ir_support()), reference_entry(api))

    assert [file.path for file in files] == [
        "__init__.py",
        "contract.py",
        "fastapi.py",
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
