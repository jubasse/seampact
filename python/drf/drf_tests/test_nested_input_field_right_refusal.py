"""An input field right below the top level is refused by name at generation: no Python target runs it yet."""

import json
from pathlib import Path

import pytest

from seampact.ir.run.generator import GenerationRefusedError

from .test_drf_generator import contract, generated_files

_REFUSED_FORM = "fieldRight.nestedPointer.unsupported"


def test_an_input_field_right_below_the_top_level_is_refused_by_name_at_its_place(repository_root: Path) -> None:
    # Read untyped, as the other targets' refusal tests do: the test edits nested members by key.
    ir_json = json.loads((repository_root / "fixtures/golden/reference/tasks.ir.json").read_text(encoding="utf-8"))
    operations = ir_json["operations"]
    position = next(index for index, operation in enumerate(operations) if operation["id"] == "createTask")
    operations[position]["fieldRights"][0]["pointer"] = "/details/effort"

    with pytest.raises(GenerationRefusedError) as refused:
        generated_files(contract(ir_json))

    [problem] = [problem for problem in refused.value.problems if problem.code == _REFUSED_FORM]

    assert "An input field right below the top level" in problem.message
    assert f"/operations/{position}/fieldRights/0/pointer (operation 'createTask')" in (problem.where or "")
