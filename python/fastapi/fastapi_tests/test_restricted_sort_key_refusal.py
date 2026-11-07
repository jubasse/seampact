"""A sort key restricted by a right is refused by name at generation: no Python target checks the right on a sort."""

import json
from pathlib import Path

import pytest

from seampact.fastapi.generator import FastApiGenerator
from seampact.ir.read import read_ir
from seampact.ir.run.generator import GenerationRefusedError

from .test_golden import reference_entry

_REFUSED_FORM = "paging.sortKey.right.unsupported"


def test_a_sort_key_restricted_by_a_right_is_refused_by_name_at_its_place(repository_root: Path) -> None:
    ir_json = json.loads((repository_root / "fixtures/golden/reference/tasks.ir.json").read_text(encoding="utf-8"))
    operations = ir_json["operations"]
    position = next(index for index, operation in enumerate(operations) if operation["id"] == "listTasks")
    operations[position]["paging"]["sortKeys"][0]["right"] = "tasks.seeEffort"
    generator = FastApiGenerator()

    with pytest.raises(GenerationRefusedError) as refused:
        generator.generate(read_ir(json.dumps(ir_json), generator.ir_support()), reference_entry("tasks"))

    [problem] = [problem for problem in refused.value.problems if problem.code == _REFUSED_FORM]

    assert "The sort key 'createdAt' restricted by the right 'tasks.seeEffort'" in problem.message
    assert f"/operations/{position}/paging/sortKeys/0 (operation 'listTasks')" in problem.where
